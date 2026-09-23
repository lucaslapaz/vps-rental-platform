import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { uuidParamSchema } from '../../shared/schemas/account.ts';
import { createVpsSchema } from '../../shared/schemas/vps.ts';
import { valid } from '../http/middlewares/validate.ts';
import { toVpsDTO, VpsRepository } from '../repositories/VpsRepository.ts';
import { OrderService } from '../services/OrderService.ts';
import { AppError } from '../utils/errors.ts';

const currentUser = (req: Request) => req.user as NonNullable<Request['user']>;

@injectable()
export class VpsController {
  constructor(
    @inject(VpsRepository) private readonly vps: VpsRepository,
    @inject(OrderService) private readonly orders: OrderService,
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
}
