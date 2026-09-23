import { inject, injectable } from 'tsyringe';
import type { Permission } from '../../shared/constants/permissions.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import { AuthenticatedUser } from '../models/AuthenticatedUser.ts';
import { SessionRepository } from '../repositories/SessionRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { randomToken, sha256Hex } from '../utils/crypto.ts';

/** Renovação do lastSeenAt/expiresAt no máximo a cada 5 min, para não gerar uma escrita por requisição (plano §9.4). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@injectable()
export class SessionService {
  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(SessionRepository) private readonly sessions: SessionRepository,
  ) {}

  private idleMs() {
    return this.env.SESSION_IDLE_TTL_HOURS * 3600 * 1000;
  }

  /** Cria a sessão. O token vai só para o cookie; no banco fica apenas o SHA-256 dele. */
  async create(userId: string, meta: { ip: string | null; userAgent: string | null }) {
    const now = this.clock.now();
    const token = randomToken(32);
    const absoluteExpiresAt = new Date(now.getTime() + this.env.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000);
    const expiresAt = new Date(Math.min(now.getTime() + this.idleMs(), absoluteExpiresAt.getTime()));
    const session = await this.sessions.create({
      tokenHash: sha256Hex(token),
      userId,
      expiresAt,
      absoluteExpiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    });
    return { token, session };
  }

  /**
   * Valida o token do cookie e devolve o usuário autenticado, ou null (sessão inexistente, revogada, expirada ou
   * usuário desativado). Expiração deslizante com teto absoluto.
   */
  async authenticate(token: string): Promise<{ user: AuthenticatedUser; expiresAt: Date; renewed: boolean } | null> {
    const found = await this.sessions.findByTokenHash(sha256Hex(token));
    const now = this.clock.now();
    if (!found || found.revokedAt || found.expiresAt <= now || found.absoluteExpiresAt <= now || !found.user.isActive) return null;

    let expiresAt = found.expiresAt;
    let renewed = false;
    if (now.getTime() - found.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
      expiresAt = new Date(Math.min(now.getTime() + this.idleMs(), found.absoluteExpiresAt.getTime()));
      await this.sessions.touch(found.id, now, expiresAt);
      renewed = true;
    }

    const { user } = found;
    const permissions = new Set(user.role.permissions.map((rp) => rp.permission.key as Permission));
    return { user: new AuthenticatedUser(user.id, user.email, user.name, user.role.key, permissions, found.id), expiresAt, renewed };
  }

  revoke(sessionId: string, userId: string) {
    return this.sessions.revoke(sessionId, userId, this.clock.now());
  }

  revokeAllForUser(userId: string, exceptSessionId?: string) {
    return this.sessions.revokeAllForUser(userId, this.clock.now(), exceptSessionId);
  }

  listActive(userId: string) {
    return this.sessions.listActive(userId, this.clock.now());
  }
}
