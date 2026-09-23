import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import { uuidParamSchema } from '../../shared/schemas/account.ts';
import { payInvoiceSchema } from '../../shared/schemas/vps.ts';
import { valid } from '../http/middlewares/validate.ts';
import { BillingService } from '../services/BillingService.ts';

const currentUser = (req: Request) => req.user as NonNullable<Request['user']>;

@injectable()
export class InvoiceController {
  constructor(@inject(BillingService) private readonly billing: BillingService) {}

  list = async (req: Request, res: Response) => {
    res.json({ invoices: await this.billing.list(currentUser(req).id) });
  };

  get = async (req: Request, res: Response) => {
    res.json({ invoice: await this.billing.get(currentUser(req).id, valid(res, 'params', uuidParamSchema).id) });
  };

  /** POST /api/invoices/:id/pay — pagamento simulado (plano §12). */
  pay = async (req: Request, res: Response) => {
    const { id } = valid(res, 'params', uuidParamSchema);
    res.json({ invoice: await this.billing.pay(currentUser(req).id, id, valid(res, 'body', payInvoiceSchema), req.ip ?? null) });
  };
}
