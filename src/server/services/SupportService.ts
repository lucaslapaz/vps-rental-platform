import { inject, injectable } from 'tsyringe';
import type { OpenConversationInput } from '../../shared/schemas/support.ts';
import type {
  ConversationStatusDTO,
  QueueItemDTO,
  SupportConversationDTO,
  SupportMessageDTO,
  SupportSystemEvent,
} from '../../shared/types/support.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { AuthenticatedUser } from '../models/AuthenticatedUser.ts';
import type { RealtimeHub } from '../realtime/RealtimeEmitter.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { AppError } from '../utils/errors.ts';

const OPEN: ConversationStatusDTO[] = ['WAITING', 'ACTIVE'];
const PAGE = 100;

const conversationInclude = {
  customer: { select: { id: true, name: true, email: true } },
  agent: { select: { id: true, name: true } },
} as const;

type ConversationRow = {
  id: string;
  subject: string;
  status: ConversationStatusDTO;
  customerId: string;
  agentId: string | null;
  createdAt: Date;
  claimedAt: Date | null;
  closedAt: Date | null;
  customer: { id: string; name: string; email: string };
  agent: { id: string; name: string } | null;
};

type MessageRow = {
  id: number;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: Date;
  sender: { id: string; name: string } | null;
};

/** Mensagem do sistema: gravada como código (a tela traduz), nunca como texto pronto em um idioma. */
const systemBody = (event: SupportSystemEvent, name?: string) => JSON.stringify({ system: event, name: name ?? null });

/**
 * Suporte (plano §13): conversas com fila, atendimento por técnicos e chat em tempo real. O técnico só vê o nome, o
 * e-mail e as mensagens do cliente (nenhum acesso a VPS ou faturas). As ações de estado (abrir, assumir, devolver,
 * encerrar) chegam por REST com CSRF; as mensagens, pelo Socket.IO (com ack) ou por REST.
 */
@injectable()
export class SupportService {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.Realtime) private readonly realtime: RealtimeHub,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  // ───────────── conversões ─────────────

  private async waitingIds() {
    const rows = await this.db.supportConversation.findMany({
      where: { status: 'WAITING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private toConversationDTO(c: ConversationRow, waiting: string[]): SupportConversationDTO {
    const index = c.status === 'WAITING' ? waiting.indexOf(c.id) : -1;
    return {
      id: c.id,
      subject: c.subject,
      status: c.status,
      customer: c.customer,
      agent: c.agent,
      queuePosition: index >= 0 ? index + 1 : null,
      createdAt: c.createdAt.toISOString(),
      claimedAt: c.claimedAt?.toISOString() ?? null,
      closedAt: c.closedAt?.toISOString() ?? null,
    };
  }

  private toMessageDTO(m: MessageRow, customerId: string): SupportMessageDTO {
    let system: SupportSystemEvent | null = null;
    let systemName: string | null = null;
    if (!m.senderId) {
      try {
        const parsed = JSON.parse(m.body) as { system: SupportSystemEvent; name: string | null };
        system = parsed.system;
        systemName = parsed.name;
      } catch {
        system = null;
      }
    }
    return {
      id: m.id,
      conversationId: m.conversationId,
      sender: m.sender ? { ...m.sender, role: m.sender.id === customerId ? 'customer' : 'agent' } : null,
      body: m.senderId ? m.body : '',
      system,
      systemName,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async load(id: string) {
    const c = await this.db.supportConversation.findUnique({ where: { id }, include: conversationInclude });
    if (!c) throw AppError.notFound('Conversa não encontrada');
    return c as ConversationRow;
  }

  /** Participante = o cliente dono ou o técnico que assumiu. Qualquer outro recebe 404 (não revela que existe). */
  private async participant(user: AuthenticatedUser, id: string) {
    const c = await this.load(id);
    if (c.customerId !== user.id && c.agentId !== user.id) throw AppError.notFound('Conversa não encontrada');
    return c;
  }

  // ───────────── tempo real ─────────────

  /** Fila mudou: técnicos recebem a fila nova e cada cliente esperando, a sua posição. */
  private async broadcastQueue() {
    const waiting = await this.queue();
    this.realtime.toAgents('support:queue:updated', { waiting });
    const rows = await this.db.supportConversation.findMany({
      where: { status: 'WAITING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, customerId: true },
    });
    rows.forEach((r, i) => {
      this.realtime.toUser(r.customerId, 'support:conversation:updated', {
        id: r.id,
        status: 'WAITING',
        agent: null,
        queuePosition: i + 1,
      });
    });
  }

  private notifyConversation(c: ConversationRow) {
    const payload = { id: c.id, status: c.status, agent: c.agent, queuePosition: null };
    this.realtime.toUser(c.customerId, 'support:conversation:updated', payload);
    if (c.agentId) this.realtime.toUser(c.agentId, 'support:conversation:updated', payload);
  }

  private async addMessage(c: { id: string; customerId: string; agentId: string | null }, senderId: string | null, body: string) {
    const row = await this.db.supportMessage.create({
      data: { conversationId: c.id, senderId, body },
      include: { sender: { select: { id: true, name: true } } },
    });
    const dto = this.toMessageDTO(row, c.customerId);
    this.realtime.toUser(c.customerId, 'support:message:new', dto);
    if (c.agentId) this.realtime.toUser(c.agentId, 'support:message:new', dto);
    return dto;
  }

  // ───────────── cliente ─────────────

  /** Abre a conversa (entra na fila). No máximo 1 conversa não encerrada por cliente. */
  async open(user: AuthenticatedUser, input: OpenConversationInput, ip: string | null) {
    const created = await this.db.$transaction(async (tx) => {
      // Trava a linha do cliente: dois pedidos simultâneos não conseguem abrir duas conversas.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`;
      const existing = await tx.supportConversation.findFirst({ where: { customerId: user.id, status: { in: OPEN } } });
      if (existing) throw new AppError(409, 'CONVERSATION_ALREADY_OPEN', 'Você já tem uma conversa aberta', { id: existing.id });
      const c = await tx.supportConversation.create({ data: { customerId: user.id, subject: input.subject.trim() } });
      await tx.supportMessage.create({ data: { conversationId: c.id, senderId: user.id, body: input.message.trim() } });
      await tx.supportMessage.create({ data: { conversationId: c.id, senderId: null, body: systemBody('queued') } });
      return c;
    });
    await this.audit.record({ action: 'support.opened', actorId: user.id, targetType: 'support_conversation', targetId: created.id, ip });
    await this.broadcastQueue();
    return this.current(user);
  }

  /** Conversa aberta do cliente (ou a última encerrada, para mostrar o fim), com a posição na fila. */
  async current(user: AuthenticatedUser): Promise<SupportConversationDTO | null> {
    const c =
      (await this.db.supportConversation.findFirst({
        where: { customerId: user.id, status: { in: OPEN } },
        include: conversationInclude,
      })) ??
      (await this.db.supportConversation.findFirst({
        where: { customerId: user.id, status: 'CLOSED' },
        include: conversationInclude,
        orderBy: { closedAt: 'desc' },
      }));
    if (!c) return null;
    return this.toConversationDTO(c as ConversationRow, await this.waitingIds());
  }

  async get(user: AuthenticatedUser, id: string) {
    return this.toConversationDTO(await this.participant(user, id), await this.waitingIds());
  }

  /** Mensagens (só participantes). `after` serve para recuperar o que chegou durante uma queda do socket. */
  async messages(user: AuthenticatedUser, id: string, query: { after?: number | undefined; before?: number | undefined }) {
    const c = await this.participant(user, id);
    const rows = await this.db.supportMessage.findMany({
      where: {
        conversationId: id,
        ...(query.after !== undefined ? { id: { gt: query.after } } : {}),
        ...(query.before !== undefined ? { id: { lt: query.before } } : {}),
      },
      include: { sender: { select: { id: true, name: true } } },
      // Página mais recente primeiro quando não há "after"; a resposta sempre sai em ordem crescente.
      orderBy: { id: query.after !== undefined ? 'asc' : 'desc' },
      take: PAGE,
    });
    const ordered = query.after !== undefined ? rows : rows.reverse();
    return ordered.map((m) => this.toMessageDTO(m, c.customerId));
  }

  /**
   * Nova mensagem de um participante. O cliente escreve enquanto espera e durante o atendimento; o técnico, só na
   * conversa que assumiu. Conversa encerrada não aceita mensagens.
   */
  async send(user: AuthenticatedUser, id: string, body: string) {
    const c = await this.participant(user, id);
    if (c.status === 'CLOSED') throw new AppError(409, 'CONVERSATION_CLOSED', 'A conversa foi encerrada');
    const asAgent = c.agentId === user.id;
    if (asAgent ? !user.can('support:conversation:reply') : !user.can('support:conversation:read:own')) {
      throw new AppError(403, 'FORBIDDEN', 'Sem permissão para responder');
    }
    return this.addMessage(c, user.id, body.trim());
  }

  /** "Digitando…" para o outro participante (sem gravar nada). */
  async typing(user: AuthenticatedUser, id: string) {
    const c = await this.participant(user, id);
    if (c.status !== 'ACTIVE') return;
    const other = c.customerId === user.id ? c.agentId : c.customerId;
    if (other) this.realtime.toUser(other, 'support:typing', { conversationId: id, userName: user.name });
  }

  /** Encerrar: o cliente dono ou o técnico que assumiu. */
  async close(user: AuthenticatedUser, id: string, ip: string | null) {
    const c = await this.participant(user, id);
    if (c.agentId === user.id && !user.can('support:conversation:close')) throw new AppError(403, 'FORBIDDEN', 'Sem permissão');
    const r = await this.db.supportConversation.updateMany({
      where: { id, status: { in: OPEN } },
      data: { status: 'CLOSED', closedAt: this.clock.now() },
    });
    if (!r.count) throw new AppError(409, 'CONVERSATION_CLOSED', 'A conversa já foi encerrada');
    await this.addMessage(c, null, systemBody('closed', user.name));
    await this.audit.record({ action: 'support.closed', actorId: user.id, targetType: 'support_conversation', targetId: id, ip });
    const updated = await this.load(id);
    this.notifyConversation(updated);
    if (c.status === 'WAITING') await this.broadcastQueue();
    return this.toConversationDTO(updated, []);
  }

  // ───────────── técnico ─────────────

  /** Fila de espera (ordem de chegada), com uma prévia da 1ª mensagem. */
  async queue(): Promise<QueueItemDTO[]> {
    const rows = await this.db.supportConversation.findMany({
      where: { status: 'WAITING' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        customer: { select: { name: true, email: true } },
        messages: { where: { senderId: { not: null } }, orderBy: { id: 'asc' }, take: 1, select: { body: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      customer: r.customer,
      preview: (r.messages[0]?.body ?? '').slice(0, 140),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async myConversations(user: AuthenticatedUser): Promise<SupportConversationDTO[]> {
    const rows = await this.db.supportConversation.findMany({
      where: { agentId: user.id, status: 'ACTIVE' },
      include: conversationInclude,
      orderBy: { claimedAt: 'asc' },
    });
    return rows.map((c) => this.toConversationDTO(c as ConversationRow, []));
  }

  /**
   * Assumir (plano §13.1): atômico com updateMany WHERE status = WAITING. Dois técnicos ao mesmo tempo → só um vence;
   * o outro recebe 409 ALREADY_CLAIMED. Respeita o limite de atendimentos simultâneos por técnico.
   */
  async claim(user: AuthenticatedUser, id: string, ip: string | null) {
    const active = await this.db.supportConversation.count({ where: { agentId: user.id, status: 'ACTIVE' } });
    if (active >= this.env.SUPPORT_MAX_ACTIVE_PER_AGENT) {
      throw new AppError(409, 'AGENT_LIMIT', `Até ${this.env.SUPPORT_MAX_ACTIVE_PER_AGENT} atendimentos ao mesmo tempo`, {
        limit: this.env.SUPPORT_MAX_ACTIVE_PER_AGENT,
      });
    }
    const r = await this.db.supportConversation.updateMany({
      where: { id, status: 'WAITING' },
      data: { status: 'ACTIVE', agentId: user.id, claimedAt: this.clock.now() },
    });
    if (!r.count) {
      await this.load(id); // 404 se não existe
      throw new AppError(409, 'ALREADY_CLAIMED', 'Esta conversa já foi assumida por outro técnico');
    }
    const c = await this.load(id);
    await this.addMessage(c, null, systemBody('claimed', user.name));
    await this.audit.record({ action: 'support.claimed', actorId: user.id, targetType: 'support_conversation', targetId: id, ip });
    this.notifyConversation(c);
    await this.broadcastQueue();
    return this.toConversationDTO(c, []);
  }

  /** Devolver para a fila (só quem assumiu). A conversa volta ao seu lugar original (ordem de chegada). */
  async release(user: AuthenticatedUser, id: string, ip: string | null) {
    const c = await this.participant(user, id);
    const r = await this.db.supportConversation.updateMany({
      where: { id, status: 'ACTIVE', agentId: user.id },
      data: { status: 'WAITING', agentId: null, claimedAt: null },
    });
    if (!r.count) throw new AppError(409, 'NOT_CLAIMED_BY_YOU', 'Esta conversa não está com você');
    await this.addMessage({ ...c, agentId: user.id }, null, systemBody('released', user.name));
    await this.audit.record({ action: 'support.released', actorId: user.id, targetType: 'support_conversation', targetId: id, ip });
    this.realtime.toUser(user.id, 'support:conversation:updated', { id, status: 'WAITING', agent: null, queuePosition: null });
    await this.broadcastQueue();
    return this.toConversationDTO(await this.load(id), await this.waitingIds());
  }
}
