import { inject, injectable } from 'tsyringe';
import type { ConsoleType } from '../../shared/schemas/vps.ts';
import type { ConsoleConnectionDTO } from '../../shared/types/catalog.ts';
import { TOKENS } from '../container/tokens.ts';
import type { VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { VpsRepository } from '../repositories/VpsRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { randomToken } from '../utils/crypto.ts';
import { AppError } from '../utils/errors.ts';

/** O consoleId vale por 30 s e só uma vez (plano §10.5). */
const CONSOLE_TTL_MS = 30_000;
/** Consoles simultâneos por usuário (abertos + em abertura). */
export const MAX_CONSOLES_PER_USER = 2;
/** Código de fechamento do WebSocket quando o usuário encerra a conexão pelo painel. */
export const CLOSE_TERMINATED = 4002;

interface ConsoleBase {
  /** Id público da conexão (listar/encerrar). Diferente do consoleId, que é o segredo de uso único do WebSocket. */
  connectionId: string;
  userId: string;
  sessionId: string;
  vpsId: string;
  hostname: string;
  type: ConsoleType;
}

export interface PendingConsole extends ConsoleBase {
  id: string;
  vmid: number;
  ticket: { port: number; ticket: string };
  /** Só no terminal: usuário do Proxmox da 1ª linha do protocolo (o proxy autentica; o navegador nunca vê o ticket). */
  terminalUser?: string;
  requestedAt: number;
  expiresAt: number;
}

interface OpenConsole extends ConsoleBase {
  openedAt: number;
  /** Fecha o WebSocket do navegador (o proxy encerra o lado do Proxmox e chama `unregister`). */
  close: (code: number, reason: string) => void;
}

/**
 * Sessões de console (plano §10.5). Ficam só em memória: o consoleId vale 30 s e não faz sentido depois de um restart
 * (o ticket do Proxmox também expira). Registrado como um por container (o estado é compartilhado entre a rota HTTP e o
 * proxy de WebSocket). Cada conexão, em abertura ou aberta, conta no limite do usuário e pode ser vista e encerrada por
 * ele (GET/DELETE /api/consoles).
 */
@injectable()
export class ConsoleService {
  private readonly pending = new Map<string, PendingConsole>();
  private readonly active = new Map<string, OpenConsole>();

  constructor(
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsRepository) private readonly vps: VpsRepository,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  private now() {
    return this.clock.now().getTime();
  }

  private purgeExpired() {
    for (const [id, p] of this.pending) if (p.expiresAt <= this.now()) this.pending.delete(id);
  }

  private inUse(userId: string) {
    this.purgeExpired();
    const pendingForUser = [...this.pending.values()].filter((p) => p.userId === userId).length;
    const openForUser = [...this.active.values()].filter((c) => c.userId === userId).length;
    return openForUser + pendingForUser;
  }

  /**
   * POST /api/vps/:id/console → { consoleId, connectionId, type, password? }. No gráfico, a senha é a do protocolo VNC
   * (vale só para este ticket); no terminal, não há senha para o navegador: o proxy faz o handshake com o ticket.
   */
  async open(user: { id: string; sessionId: string }, vpsId: string, ip: string | null, type: ConsoleType = 'vnc') {
    const vps = await this.vps.findOwned(vpsId, user.id);
    if (!vps || vps.status === 'DELETED') throw AppError.notFound('VPS não encontrada');
    if (vps.status !== 'RUNNING' || !vps.pveVmid) throw new AppError(409, 'VPS_NOT_RUNNING', 'Ligue a VPS para abrir o console');
    // Um pedido novo da mesma sessão para a mesma VPS substitui os que ainda não conectaram (tentar de novo não
    // acumula sessões presas no limite).
    for (const [id, p] of this.pending) if (p.sessionId === user.sessionId && p.vpsId === vps.id) this.pending.delete(id);
    if (this.inUse(user.id) >= MAX_CONSOLES_PER_USER) {
      throw new AppError(429, 'CONSOLE_LIMIT', `Até ${MAX_CONSOLES_PER_USER} consoles abertos ao mesmo tempo`, {
        limit: MAX_CONSOLES_PER_USER,
      });
    }
    const id = randomToken(24);
    const now = this.now();
    const base = {
      id,
      connectionId: randomToken(12),
      userId: user.id,
      sessionId: user.sessionId,
      vpsId: vps.id,
      hostname: vps.hostname,
      vmid: vps.pveVmid,
      type,
      requestedAt: now,
      expiresAt: now + CONSOLE_TTL_MS,
    };
    let password: string | undefined;
    if (type === 'serial') {
      const t = await this.vms.openTerminal(vps.pveVmid);
      this.pending.set(id, { ...base, ticket: { port: t.port, ticket: t.ticket }, terminalUser: t.user });
    } else {
      const t = await this.vms.openConsole(vps.pveVmid);
      password = t.password;
      this.pending.set(id, { ...base, ticket: { port: t.port, ticket: t.ticket } });
    }
    await this.audit.record({
      action: 'vps.console_requested',
      actorId: user.id,
      targetType: 'vps',
      targetId: vps.id,
      metadata: { type },
      ip,
    });
    return { consoleId: id, connectionId: base.connectionId, type, ...(password ? { password } : {}) };
  }

  /**
   * Consome o consoleId no upgrade do WebSocket: uso único, dentro do prazo e da MESMA sessão que o pediu. Qualquer
   * outra situação (reutilizado, vencido, de outro usuário) → null, sem dizer o motivo.
   */
  consume(consoleId: string, user: { id: string; sessionId: string }): PendingConsole | null {
    const found = this.pending.get(consoleId);
    if (!found) return null;
    this.pending.delete(consoleId);
    if (found.expiresAt <= this.now() || found.userId !== user.id || found.sessionId !== user.sessionId) return null;
    return found;
  }

  /** O proxy registra o WebSocket aberto (conta no limite até `unregister`). */
  register(session: PendingConsole, close: OpenConsole['close']) {
    const { connectionId, userId, sessionId, vpsId, hostname, type } = session;
    this.active.set(connectionId, { connectionId, userId, sessionId, vpsId, hostname, type, openedAt: this.now(), close });
  }

  unregister(connectionId: string) {
    this.active.delete(connectionId);
  }

  /** GET /api/consoles: as conexões do usuário, das mais recentes para as mais antigas. */
  list(user: { id: string; sessionId: string }): ConsoleConnectionDTO[] {
    this.purgeExpired();
    const pending = [...this.pending.values()]
      .filter((p) => p.userId === user.id)
      .map((p) => ({ ...p, state: 'connecting' as const, at: p.requestedAt }));
    const open = [...this.active.values()]
      .filter((c) => c.userId === user.id)
      .map((c) => ({ ...c, state: 'open' as const, at: c.openedAt }));
    return [...open, ...pending]
      .sort((a, b) => b.at - a.at)
      .map((c) => ({
        id: c.connectionId,
        vpsId: c.vpsId,
        hostname: c.hostname,
        type: c.type,
        state: c.state,
        since: new Date(c.at).toISOString(),
        sameSession: c.sessionId === user.sessionId,
      }));
  }

  /**
   * DELETE /api/consoles/:id: encerra uma conexão do próprio usuário (de qualquer aba ou dispositivo dele) e libera a
   * vaga na hora. De outro usuário ou inexistente → 404 (não revela que existe).
   */
  async terminate(user: { id: string }, connectionId: string, ip: string | null) {
    let vpsId: string | null = null;
    const open = this.active.get(connectionId);
    if (open?.userId === user.id) {
      vpsId = open.vpsId;
      this.active.delete(connectionId);
      open.close(CLOSE_TERMINATED, 'terminated');
    } else {
      for (const [id, p] of this.pending) {
        if (p.connectionId === connectionId && p.userId === user.id) {
          vpsId = p.vpsId;
          this.pending.delete(id);
        }
      }
    }
    if (!vpsId) throw AppError.notFound('Conexão não encontrada');
    await this.audit.record({ action: 'vps.console_terminated', actorId: user.id, targetType: 'vps', targetId: vpsId, ip });
  }
}
