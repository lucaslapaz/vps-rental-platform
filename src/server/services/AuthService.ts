import { inject, injectable } from 'tsyringe';
import type { ChangePasswordInput, LoginInput, RegisterInput } from '../../shared/schemas/auth.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { UserRepository } from '../repositories/UserRepository.ts';
import { AppError } from '../utils/errors.ts';
import { hashPassword, verifyPassword } from '../utils/password.ts';
import { SessionService } from './SessionService.ts';

/** Hash fictício: quando o e-mail não existe, a senha é comparada com ele para igualar o tempo de resposta (§9.3). */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => {
  dummyHash ??= hashPassword('favo-dummy-password-for-timing');
  return dummyHash;
};

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

@injectable()
export class AuthService {
  constructor(
    @inject(UserRepository) private readonly users: UserRepository,
    @inject(SessionService) private readonly sessions: SessionService,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  /** Cadastro de cliente (sempre a role `customer`) + login automático (plano §9.6). */
  async register(input: Required<Pick<RegisterInput, 'name' | 'email' | 'password'>>, meta: RequestMeta) {
    if (await this.users.findByEmail(input.email)) throw new AppError(409, 'EMAIL_TAKEN', 'E-mail já cadastrado');
    const user = await this.users.create({
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      roleKey: 'customer',
    });
    await this.audit.record({ action: 'auth.register', actorId: user.id, targetType: 'user', targetId: user.id, ip: meta.ip });
    return this.sessions.create(user.id, meta);
  }

  /** Login com mensagem genérica ("e-mail ou senha inválidos") em qualquer falha, para não revelar quais e-mails existem. */
  async login(input: Required<LoginInput>, meta: RequestMeta) {
    const user = await this.users.findByEmail(input.email);
    const ok = user ? await verifyPassword(user.passwordHash, input.password) : await verifyPassword(await getDummyHash(), input.password);
    if (!user || !ok || !user.isActive) {
      await this.audit.record({ action: 'auth.login_failed', actorId: user?.id ?? null, metadata: { email: input.email }, ip: meta.ip });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos');
    }
    await this.audit.record({ action: 'auth.login', actorId: user.id, ip: meta.ip });
    return this.sessions.create(user.id, meta);
  }

  async logout(userId: string, sessionId: string, meta: RequestMeta) {
    await this.sessions.revoke(sessionId, userId);
    await this.audit.record({ action: 'auth.logout', actorId: userId, ip: meta.ip });
  }

  /** Troca a senha e revoga as OUTRAS sessões (a atual continua). */
  async changePassword(userId: string, currentSessionId: string, input: Required<ChangePasswordInput>, meta: RequestMeta) {
    const user = await this.users.findById(userId);
    if (!user || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'Senha atual incorreta');
    }
    await this.users.updatePasswordHash(userId, await hashPassword(input.newPassword));
    const revoked = await this.sessions.revokeAllForUser(userId, currentSessionId);
    await this.audit.record({ action: 'account.password_changed', actorId: userId, metadata: { revokedSessions: revoked }, ip: meta.ip });
    return { revokedSessions: revoked };
  }
}
