import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { loginSchema, registerSchema } from '../../shared/schemas/auth.ts';
import type { PublicUser } from '../../shared/types/auth.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import { clearSessionCookie, setSessionCookie } from '../http/cookies.ts';
import { ensureCsrfCookie, rotateCsrfForSession, rotateCsrfForVisitor } from '../http/csrfCookies.ts';
import { requestMeta, valid } from '../http/middlewares/validate.ts';
import { AuthService } from '../services/AuthService.ts';
import { CsrfService } from '../services/CsrfService.ts';
import { SessionService } from '../services/SessionService.ts';
import { AppError } from '../utils/errors.ts';

@injectable()
export class AuthController {
  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(AuthService) private readonly auth: AuthService,
    @inject(SessionService) private readonly sessions: SessionService,
    @inject(CsrfService) private readonly csrf: CsrfService,
  ) {}

  /** Grava a sessão nova nos cookies e devolve o usuário (mesma resposta para login e cadastro, plano §9.6). */
  private async startSession(res: Response, token: string, absoluteExpiresAt: Date) {
    setSessionCookie(res, this.env, token, absoluteExpiresAt);
    rotateCsrfForSession(res, this.env, this.csrf, token);
    const result = await this.sessions.authenticate(token);
    if (!result) throw new AppError(500, 'INTERNAL_ERROR', 'Sessão recém-criada não encontrada');
    res.json({ user: result.user.toPublic() });
  }

  /** GET /api/auth/csrf: reemite o token (o cliente chama ao receber CSRF_INVALID e repete a requisição). */
  csrfToken = (req: Request, res: Response) => {
    ensureCsrfCookie(req, res, this.env, this.csrf, { force: true });
    res.status(204).end();
  };

  /** GET /api/auth/me */
  me = (req: Request, res: Response<{ user: PublicUser }>) => {
    res.set('Cache-Control', 'no-store').json({ user: (req.user as NonNullable<Request['user']>).toPublic() });
  };

  register = async (req: Request, res: Response) => {
    const input = valid(res, 'body', registerSchema);
    const { token, session } = await this.auth.register(input, requestMeta(req));
    await this.startSession(res, token, session.absoluteExpiresAt);
  };

  login = async (req: Request, res: Response) => {
    const input = valid(res, 'body', loginSchema);
    const { token, session } = await this.auth.login(input, requestMeta(req));
    await this.startSession(res, token, session.absoluteExpiresAt);
  };

  logout = async (req: Request, res: Response) => {
    const user = req.user as NonNullable<Request['user']>;
    await this.auth.logout(user.id, user.sessionId, requestMeta(req));
    clearSessionCookie(res, this.env);
    rotateCsrfForVisitor(res, this.env, this.csrf);
    res.status(204).end();
  };
}
