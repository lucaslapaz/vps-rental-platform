import { Router } from 'express';
import type { DependencyContainer } from 'tsyringe';
import { changeRoleSchema, intIdParamSchema, sshKeySchema, userSearchSchema, uuidParamSchema } from '../../../shared/schemas/account.ts';
import { changePasswordSchema, loginSchema, registerSchema } from '../../../shared/schemas/auth.ts';
import { messagesQuerySchema, openConversationSchema, sendBodySchema } from '../../../shared/schemas/support.ts';
import {
  consoleRequestSchema,
  createVpsSchema,
  metricsQuerySchema,
  payInvoiceSchema,
  renameVpsSchema,
  resizeVpsSchema,
  sshPasswordAuthSchema,
  vpsActionParamsSchema,
  vpsAddSshKeySchema,
  vpsPasswordSchema,
} from '../../../shared/schemas/vps.ts';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import { AccountController } from '../../controllers/AccountController.ts';
import { AdminController } from '../../controllers/AdminController.ts';
import { AuthController } from '../../controllers/AuthController.ts';
import { CatalogController } from '../../controllers/CatalogController.ts';
import { HealthController } from '../../controllers/HealthController.ts';
import { InvoiceController } from '../../controllers/InvoiceController.ts';
import { SupportController } from '../../controllers/SupportController.ts';
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
  const support = di.resolve(SupportController);

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

  // ── VPS ──
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
  router.get('/vps/:id/events', A, P('vps:read:own'), validate({ params: uuidParamSchema }), vps.events);
  const manage = P('vps:manage:own');
  const vpsOps = limiter(env, { windowMinutes: 5, limit: 30 });
  router.post('/vps/:id/actions/:action', O, vpsOps, C, A, manage, validate({ params: vpsActionParamsSchema }), vps.action);
  router.post('/vps/:id/resize', O, vpsOps, C, A, manage, validate({ params: uuidParamSchema, body: resizeVpsSchema }), vps.resize);
  router.delete('/vps/:id', O, vpsOps, C, A, P('vps:delete:own'), validate({ params: uuidParamSchema }), vps.remove);
  router.patch('/vps/:id', O, vpsOps, C, A, manage, validate({ params: uuidParamSchema, body: renameVpsSchema }), vps.rename);
  router.get('/vps/:id/live', A, P('vps:read:own'), validate({ params: uuidParamSchema }), vps.live);
  router.get('/vps/:id/metrics', A, P('vps:read:own'), validate({ params: uuidParamSchema, query: metricsQuerySchema }), vps.metrics);
  // Acesso pelo guest agent (§10.6): limite mais baixo, porque cada chamada executa algo dentro da VM.
  const access = limiter(env, { windowMinutes: 15, limit: 20 });
  router.post(
    '/vps/:id/access/password',
    O,
    access,
    C,
    A,
    manage,
    validate({ params: uuidParamSchema, body: vpsPasswordSchema }),
    vps.setPassword,
  );
  router.post(
    '/vps/:id/access/ssh-password-auth',
    O,
    access,
    C,
    A,
    manage,
    validate({ params: uuidParamSchema, body: sshPasswordAuthSchema }),
    vps.setSshPasswordAuth,
  );
  router.post(
    '/vps/:id/access/ssh-keys',
    O,
    access,
    C,
    A,
    manage,
    validate({ params: uuidParamSchema, body: vpsAddSshKeySchema }),
    vps.addSshKey,
  );
  router.post(
    '/vps/:id/console',
    O,
    limiter(env, { windowMinutes: 5, limit: 20 }),
    C,
    A,
    P('vps:console:own'),
    validate({ params: uuidParamSchema, body: consoleRequestSchema }),
    vps.console,
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

  // ── Suporte (plano §13 e §15). Participação e estado da conversa são conferidos no SupportService. ──
  const id = validate({ params: uuidParamSchema });
  router.post(
    '/support/conversations',
    O,
    limiter(env, { windowMinutes: 60, limit: 10 }),
    C,
    A,
    P('support:conversation:create'),
    validate({ body: openConversationSchema }),
    support.open,
  );
  router.get('/support/conversations/current', A, P('support:conversation:read:own'), support.current);
  router.get('/support/queue', A, P('support:queue:read'), support.queue);
  router.get('/support/my-conversations', A, P('support:queue:read'), support.mine);
  router.get('/support/conversations/:id', A, id, support.get);
  router.get('/support/conversations/:id/messages', A, validate({ params: uuidParamSchema, query: messagesQuerySchema }), support.messages);
  router.post(
    '/support/conversations/:id/messages',
    O,
    limiter(env, { windowMinutes: 1, limit: 30 }),
    C,
    A,
    validate({ params: uuidParamSchema, body: sendBodySchema }),
    support.send,
  );
  router.post('/support/conversations/:id/close', O, C, A, id, support.close);
  router.post('/support/conversations/:id/claim', O, C, A, P('support:conversation:claim'), id, support.claim);
  router.post('/support/conversations/:id/release', O, C, A, P('support:conversation:claim'), id, support.release);

  return router;
}
