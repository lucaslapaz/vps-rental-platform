import { Router } from 'express';
import type { DependencyContainer } from 'tsyringe';
import { changeRoleSchema, intIdParamSchema, sshKeySchema, userSearchSchema, uuidParamSchema } from '../../../shared/schemas/account.ts';
import { changePasswordSchema, loginSchema, registerSchema } from '../../../shared/schemas/auth.ts';
import { createVpsSchema, payInvoiceSchema } from '../../../shared/schemas/vps.ts';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import { AccountController } from '../../controllers/AccountController.ts';
import { AdminController } from '../../controllers/AdminController.ts';
import { AuthController } from '../../controllers/AuthController.ts';
import { CatalogController } from '../../controllers/CatalogController.ts';
import { HealthController } from '../../controllers/HealthController.ts';
import { InvoiceController } from '../../controllers/InvoiceController.ts';
import { VpsController } from '../../controllers/VpsController.ts';
import { CsrfService } from '../../services/CsrfService.ts';
import { SessionService } from '../../services/SessionService.ts';
import { authenticate, requirePermission } from '../middlewares/auth.ts';
import { limiter } from '../middlewares/rateLimit.ts';
import { csrfProtection, originCheck } from '../middlewares/security.ts';
import { validate } from '../middlewares/validate.ts';

/**
 * Todas as rotas da API, montadas em /api (referência no plano §15). Ordem dos middlewares numa rota que altera dados:
 * originCheck → rateLimit → csrf → authenticate → requirePermission → validate → controller (plano §9.5).
 */
export function createApiRouter(di: DependencyContainer) {
  const env = di.resolve<Env>(TOKENS.Env);
  const sessions = di.resolve(SessionService);
  const O = originCheck(env);
  const C = csrfProtection(env, di.resolve(CsrfService));
  const A = authenticate(env, sessions);
  const P = requirePermission;

  const health = di.resolve(HealthController);
  const auth = di.resolve(AuthController);
  const account = di.resolve(AccountController);
  const admin = di.resolve(AdminController);
  const catalog = di.resolve(CatalogController);
  const vps = di.resolve(VpsController);
  const invoices = di.resolve(InvoiceController);

  const router = Router();
  router.get('/health', health.show);

  // ── Autenticação ──
  router.get('/auth/csrf', auth.csrfToken);
  router.get('/auth/me', A, auth.me);
  router.post('/auth/register', O, limiter(env, { windowMinutes: 60, limit: 10 }), C, validate({ body: registerSchema }), auth.register);
  router.post(
    '/auth/login',
    O,
    limiter(env, { windowMinutes: 15, limit: 20 }),
    limiter(env, { windowMinutes: 15, limit: 5, by: 'email' }),
    C,
    validate({ body: loginSchema }),
    auth.login,
  );
  router.post('/auth/logout', O, C, A, auth.logout);

  // ── Minha conta ──
  const own = P('account:manage:own');
  router.get('/account/sessions', A, own, account.listSessions);
  router.delete('/account/sessions/:id', O, C, A, own, validate({ params: uuidParamSchema }), account.revokeSession);
  router.put(
    '/account/password',
    O,
    limiter(env, { windowMinutes: 15, limit: 10 }),
    C,
    A,
    own,
    validate({ body: changePasswordSchema }),
    account.changePassword,
  );
  const keys = P('sshkey:manage:own');
  router.get('/account/ssh-keys', A, keys, account.listSshKeys);
  router.post('/account/ssh-keys', O, C, A, keys, validate({ body: sshKeySchema }), account.addSshKey);
  router.delete('/account/ssh-keys/:id', O, C, A, keys, validate({ params: intIdParamSchema }), account.removeSshKey);

  // ── Administração ──
  router.get('/admin/users', A, P('admin:users:read'), validate({ query: userSearchSchema }), admin.listUsers);
  router.get('/admin/roles', A, P('admin:users:read'), admin.listRoles);
  router.patch(
    '/admin/users/:id/role',
    O,
    C,
    A,
    P('admin:users:assign-role'),
    validate({ params: uuidParamSchema, body: changeRoleSchema }),
    admin.changeRole,
  );

  // ── Catálogo (público) ──
  router.get('/plans', catalog.plans);
  router.get('/os-templates', catalog.osTemplates);

  // ── VPS (Fase 5: pedido; as ações entram nas fases 6 e 7) ──
  router.get('/vps', A, P('vps:read:own'), vps.list);
  router.get('/vps/:id', A, P('vps:read:own'), validate({ params: uuidParamSchema }), vps.get);
  router.post(
    '/vps',
    O,
    limiter(env, { windowMinutes: 60, limit: 20 }),
    C,
    A,
    P('vps:create'),
    validate({ body: createVpsSchema }),
    vps.create,
  );

  // ── Faturas e pagamento simulado ──
  router.get('/invoices', A, P('billing:read:own'), invoices.list);
  router.get('/invoices/:id', A, P('billing:read:own'), validate({ params: uuidParamSchema }), invoices.get);
  router.post(
    '/invoices/:id/pay',
    O,
    limiter(env, { windowMinutes: 15, limit: 20 }),
    C,
    A,
    P('billing:pay:own'),
    validate({ params: uuidParamSchema, body: payInvoiceSchema }),
    invoices.pay,
  );

  return router;
}
