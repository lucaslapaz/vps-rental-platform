import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { intIdParamSchema, sshKeySchema, uuidParamSchema } from '../../shared/schemas/account.ts';
import { changePasswordSchema } from '../../shared/schemas/auth.ts';
import type { SessionDTO } from '../../shared/types/auth.ts';
import { requestMeta, valid } from '../http/middlewares/validate.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { AuthService } from '../services/AuthService.ts';
import { SessionService } from '../services/SessionService.ts';
import { SshKeyService } from '../services/SshKeyService.ts';
import { AppError } from '../utils/errors.ts';

const currentUser = (req: Request) => req.user as NonNullable<Request['user']>;

@injectable()
export class AccountController {
  constructor(
    @inject(AuthService) private readonly auth: AuthService,
    @inject(SessionService) private readonly sessions: SessionService,
    @inject(SshKeyService) private readonly sshKeys: SshKeyService,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  /** GET /api/account/sessions */
  listSessions = async (req: Request, res: Response<{ sessions: SessionDTO[] }>) => {
    const user = currentUser(req);
    const sessions = await this.sessions.listActive(user.id);
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.id === user.sessionId,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        ip: s.ip,
        userAgent: s.userAgent,
      })),
    });
  };

  /** DELETE /api/account/sessions/:id (a sessão atual sai pelo logout) */
  revokeSession = async (req: Request, res: Response) => {
    const user = currentUser(req);
    const { id } = valid(res, 'params', uuidParamSchema);
    if (id === user.sessionId) throw new AppError(400, 'USE_LOGOUT', 'Para encerrar a sessão atual, use Sair');
    if (!(await this.sessions.revoke(id, user.id))) throw AppError.notFound('Sessão não encontrada');
    await this.audit.record({
      action: 'account.session_revoked',
      actorId: user.id,
      targetType: 'session',
      targetId: id,
      ip: req.ip ?? null,
    });
    res.status(204).end();
  };

  /** PUT /api/account/password (revoga as outras sessões) */
  changePassword = async (req: Request, res: Response) => {
    const user = currentUser(req);
    const result = await this.auth.changePassword(user.id, user.sessionId, valid(res, 'body', changePasswordSchema), requestMeta(req));
    res.json(result);
  };

  listSshKeys = async (req: Request, res: Response) => {
    res.json({ keys: await this.sshKeys.list(currentUser(req).id) });
  };

  addSshKey = async (req: Request, res: Response) => {
    const key = await this.sshKeys.add(currentUser(req).id, valid(res, 'body', sshKeySchema), req.ip ?? null);
    res.status(201).json({ key });
  };

  removeSshKey = async (req: Request, res: Response) => {
    await this.sshKeys.remove(currentUser(req).id, valid(res, 'params', intIdParamSchema).id, req.ip ?? null);
    res.status(204).end();
  };
}
