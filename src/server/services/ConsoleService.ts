import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { ConsoleTicket, VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { VpsRepository } from '../repositories/VpsRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { randomToken } from '../utils/crypto.ts';
import { AppError } from '../utils/errors.ts';

/** O consoleId vale por 30 s e só uma vez (plano §10.5). */
const CONSOLE_TTL_MS = 30_000;
/** Consoles simultâneos por usuário (abertos + em abertura). */
export const MAX_CONSOLES_PER_USER = 2;

export interface PendingConsole {
  id: string;
  userId: string;
  sessionId: string;
  vpsId: string;
  hostname: string;
  vmid: number;
  ticket: ConsoleTicket;
  expiresAt: number;
}

/**
 * Sessões de console de uso único (plano §10.5). Ficam só em memória: sobrevivem 30 s e não fazem sentido depois de
 * um restart (o ticket do Proxmox também expira). Registrado como um por container (o estado é compartilhado entre a
 * rota HTTP e o proxy de WebSocket).
 */
@injectable()
export class ConsoleService {
  private readonly pending = new Map<string, PendingConsole>();
  private readonly active = new Map<string, number>();

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
    return (this.active.get(userId) ?? 0) + pendingForUser;
  }

  /** POST /api/vps/:id/console → { consoleId, password }. A senha é a do protocolo VNC (vale só para este ticket). */
  async open(user: { id: string; sessionId: string }, vpsId: string, ip: string | null) {
    const vps = await this.vps.findOwned(vpsId, user.id);
    if (!vps || vps.status === 'DELETED') throw AppError.notFound('VPS não encontrada');
    if (vps.status !== 'RUNNING' || !vps.pveVmid) throw new AppError(409, 'VPS_NOT_RUNNING', 'Ligue a VPS para abrir o console');
    if (this.inUse(user.id) >= MAX_CONSOLES_PER_USER) {
      throw new AppError(429, 'CONSOLE_LIMIT', `Até ${MAX_CONSOLES_PER_USER} consoles abertos ao mesmo tempo`, {
        limit: MAX_CONSOLES_PER_USER,
      });
    }
    const ticket = await this.vms.openConsole(vps.pveVmid);
    const id = randomToken(24);
    this.pending.set(id, {
      id,
      userId: user.id,
      sessionId: user.sessionId,
      vpsId: vps.id,
      hostname: vps.hostname,
      vmid: vps.pveVmid,
      ticket,
      expiresAt: this.now() + CONSOLE_TTL_MS,
    });
    await this.audit.record({ action: 'vps.console_requested', actorId: user.id, targetType: 'vps', targetId: vps.id, ip });
    return { consoleId: id, password: ticket.password };
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

  opened(userId: string) {
    this.active.set(userId, (this.active.get(userId) ?? 0) + 1);
  }

  closed(userId: string) {
    const n = (this.active.get(userId) ?? 1) - 1;
    if (n <= 0) this.active.delete(userId);
    else this.active.set(userId, n);
  }
}
