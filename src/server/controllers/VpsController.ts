import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { uuidParamSchema } from '../../shared/schemas/account.ts';
import {
  consoleConnectionParamSchema,
  consoleRequestSchema,
  createVpsSchema,
  metricsQuerySchema,
  renameVpsSchema,
  resizeVpsSchema,
  sshPasswordAuthSchema,
  vpsActionParamsSchema,
  vpsAddSshKeySchema,
  vpsPasswordSchema,
} from '../../shared/schemas/vps.ts';
import { valid } from '../http/middlewares/validate.ts';
import { toVpsDTO, VpsRepository } from '../repositories/VpsRepository.ts';
import { ConsoleService, MAX_CONSOLES_PER_USER } from '../services/ConsoleService.ts';
import { OrderService } from '../services/OrderService.ts';
import { VpsAccessService } from '../services/VpsAccessService.ts';
import { VpsInsightsService } from '../services/VpsInsightsService.ts';
import { VpsService } from '../services/VpsService.ts';
import { AppError } from '../utils/errors.ts';

const currentUser = (req: Request) => req.user as NonNullable<Request['user']>;

@injectable()
export class VpsController {
  constructor(
    @inject(VpsRepository) private readonly vps: VpsRepository,
    @inject(OrderService) private readonly orders: OrderService,
    @inject(VpsService) private readonly service: VpsService,
    @inject(VpsAccessService) private readonly access: VpsAccessService,
    @inject(VpsInsightsService) private readonly insights: VpsInsightsService,
    @inject(ConsoleService) private readonly consoles: ConsoleService,
  ) {}

  /** GET /api/vps */
  list = async (req: Request, res: Response) => {
    res.json({ vps: (await this.vps.listForUser(currentUser(req).id)).map(toVpsDTO) });
  };

  /** GET /api/vps/:id — de outro usuário → 404, para não revelar que existe (plano §9.5). */
  get = async (req: Request, res: Response) => {
    const found = await this.vps.findOwned(valid(res, 'params', uuidParamSchema).id, currentUser(req).id);
    if (!found) throw AppError.notFound('VPS não encontrada');
    res.json({ vps: toVpsDTO(found) });
  };

  /** POST /api/vps — cria o pedido (VPS aguardando pagamento + fatura). */
  create = async (req: Request, res: Response) => {
    const result = await this.orders.create(currentUser(req).id, valid(res, 'body', createVpsSchema), req.ip ?? null);
    res.status(201).json(result);
  };

  /** POST /api/vps/:id/actions/:action — 202: o resultado chega por vps:status. */
  action = async (req: Request, res: Response) => {
    const { id, action } = valid(res, 'params', vpsActionParamsSchema);
    res.status(202).json({ vps: await this.service.powerAction(currentUser(req).id, id, action, req.ip ?? null) });
  };

  /** POST /api/vps/:id/resize */
  resize = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    const { plan } = valid(res, 'body', resizeVpsSchema);
    res.status(202).json({ vps: await this.service.resize(currentUser(req).id, id, plan, req.ip ?? null) });
  };

  /** DELETE /api/vps/:id */
  remove = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.status(202).json({ vps: await this.service.remove(currentUser(req).id, id, req.ip ?? null) });
  };

  /** PATCH /api/vps/:id — renomear. */
  rename = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    const { hostname } = valid(res, 'body', renameVpsSchema);
    res.json({ vps: await this.access.rename(currentUser(req).id, id, hostname, req.ip ?? null) });
  };

  /** POST /api/vps/:id/access/password */
  setPassword = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ vps: await this.access.setPassword(currentUser(req).id, id, valid(res, 'body', vpsPasswordSchema), req.ip ?? null) });
  };

  /** POST /api/vps/:id/access/ssh-password-auth */
  setSshPasswordAuth = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    const { enabled } = valid(res, 'body', sshPasswordAuthSchema);
    res.json({ vps: await this.access.setSshPasswordAuth(currentUser(req).id, id, enabled, req.ip ?? null) });
  };

  /** POST /api/vps/:id/access/ssh-keys */
  addSshKey = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ vps: await this.access.addSshKey(currentUser(req).id, id, valid(res, 'body', vpsAddSshKeySchema), req.ip ?? null) });
  };

  /** POST /api/vps/:id/console — sessão de console de uso único (30 s). */
  console = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    const user = currentUser(req);
    const { type } = valid(res, 'body', consoleRequestSchema);
    res.status(201).json(await this.consoles.open({ id: user.id, sessionId: user.sessionId }, id, req.ip ?? null, type));
  };

  /** GET /api/consoles: conexões de console do usuário (em abertura ou abertas). */
  consoleConnections = (req: Request, res: Response) => {
    const user = currentUser(req);
    res.json({ connections: this.consoles.list({ id: user.id, sessionId: user.sessionId }), limit: MAX_CONSOLES_PER_USER });
  };

  /** DELETE /api/consoles/:id: encerra uma conexão do próprio usuário e libera a vaga. */
  terminateConsole = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', consoleConnectionParamSchema);
    await this.consoles.terminate(currentUser(req), id, req.ip ?? null);
    res.status(204).end();
  };

  /** GET /api/vps/:id/live */
  live = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ live: await this.insights.live(currentUser(req).id, id) });
  };

  /** GET /api/vps/:id/metrics?timeframe=hour|day|week */
  metrics = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    const { timeframe } = valid(res, 'query', metricsQuerySchema);
    res.json({ timeframe, points: await this.insights.metrics(currentUser(req).id, id, timeframe) });
  };

  /** GET /api/vps/:id/events */
  events = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ events: await this.service.events(currentUser(req).id, id) });
  };
}
