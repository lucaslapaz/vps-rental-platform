import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import type { payInvoiceSchema } from '../../shared/schemas/vps.ts';
import type { InvoiceDTO, VpsStatusDTO } from '../../shared/types/catalog.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { PaymentGateway } from '../integrations/payment/PaymentGateway.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { AppError } from '../utils/errors.ts';

type PayInput = import('zod').output<typeof payInvoiceSchema>;

type InvoiceRow = {
  id: string;
  number: number;
  description: string;
  amountCents: number;
  status: string;
  dueAt: Date;
  paidAt: Date | null;
  createdAt: Date;
  vps: { id: string; hostname: string; status: string } | null;
  payments: { id: string; status: string; cardBrand: string; cardLast4: string; failureCode: string | null; createdAt: Date }[];
};

export function toInvoiceDTO(i: InvoiceRow): InvoiceDTO {
  return {
    id: i.id,
    number: i.number,
    description: i.description,
    amountCents: i.amountCents,
    currency: 'BRL',
    status: i.status as InvoiceDTO['status'],
    dueAt: i.dueAt.toISOString(),
    paidAt: i.paidAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
    vps: i.vps ? { id: i.vps.id, hostname: i.vps.hostname, status: i.vps.status as VpsStatusDTO } : null,
    payments: [...i.payments]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((p) => ({
        id: p.id,
        status: p.status as 'APPROVED' | 'DECLINED',
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        failureCode: p.failureCode,
        createdAt: p.createdAt.toISOString(),
      })),
  };
}

const include = { vps: { select: { id: true, hostname: true, status: true } }, payments: true } as const;

@injectable()
export class BillingService {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.PaymentGateway) private readonly gateway: PaymentGateway,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async list(userId: string): Promise<InvoiceDTO[]> {
    const rows = await this.db.invoice.findMany({ where: { userId }, include, orderBy: { createdAt: 'desc' } });
    return rows.map(toInvoiceDTO);
  }

  async get(userId: string, id: string): Promise<InvoiceDTO> {
    const row = await this.db.invoice.findFirst({ where: { id, userId }, include });
    if (!row) throw AppError.notFound('Fatura não encontrada');
    return toInvoiceDTO(row);
  }

  /**
   * POST /api/invoices/:id/pay (plano §12). A fatura é travada com SELECT … FOR UPDATE durante a cobrança: um segundo
   * pagamento simultâneo espera o primeiro terminar e recebe 409 (nunca há cobrança dupla). Aprovado → fatura PAID,
   * VPS PROVISIONING e job provision_vps NA MESMA TRANSAÇÃO (outbox, §11.2), com as senhas ainda cifradas.
   * Recusado → o pagamento recusado fica registrado e a fatura continua em aberto, para tentar de novo.
   */
  async pay(userId: string, invoiceId: string, card: PayInput, ip: string | null): Promise<InvoiceDTO> {
    const outcome = await this.db.$transaction(
      async (tx) => {
        const [locked] = await tx.$queryRaw<
          { id: string; status: string; amountCents: number; dueAt: Date; vpsId: string | null; description: string }[]
        >`
          SELECT id, status, amountCents, dueAt, vpsId, description FROM invoices WHERE id = ${invoiceId} AND userId = ${userId} FOR UPDATE`;
        if (!locked) throw AppError.notFound('Fatura não encontrada');
        if (locked.status !== 'PENDING')
          throw new AppError(409, 'INVOICE_NOT_PAYABLE', 'Esta fatura não está em aberto', { status: locked.status });
        if (new Date(locked.dueAt) <= this.clock.now()) throw new AppError(409, 'INVOICE_EXPIRED', 'O prazo desta fatura acabou');

        const paymentId = randomUUID();
        const result = await this.gateway.charge({
          amountCents: locked.amountCents,
          currency: 'BRL',
          description: locked.description,
          card: { number: card.cardNumber, holder: card.holder, expMonth: card.expMonth, expYear: card.expYear, cvc: card.cvc },
          idempotencyKey: paymentId,
        });
        await tx.payment.create({
          data: {
            id: paymentId,
            invoiceId,
            status: result.status,
            amountCents: locked.amountCents,
            cardBrand: result.brand,
            cardLast4: result.last4,
            gatewayReference: result.reference,
            failureCode: result.status === 'DECLINED' ? result.failureCode : null,
          },
        });
        if (result.status === 'DECLINED') return { approved: false as const, failureCode: result.failureCode };

        const now = this.clock.now();
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: now } });
        if (locked.vpsId) {
          const vps = await tx.vps.findUniqueOrThrow({ where: { id: locked.vpsId }, select: { status: true, provisionSecrets: true } });
          if (vps.status === 'PENDING_PAYMENT') {
            await tx.vps.update({ where: { id: locked.vpsId }, data: { status: 'PROVISIONING', provisionSecrets: null } });
            await tx.job.create({ data: { type: 'provision_vps', payload: { vpsId: locked.vpsId, secrets: vps.provisionSecrets } } });
            await tx.vpsEvent.create({ data: { vpsId: locked.vpsId, actorId: userId, action: 'payment', status: 'succeeded' } });
          }
        }
        return { approved: true as const };
      },
      // A cobrança simulada leva 1–2 s e acontece com a fatura travada.
      { timeout: 20_000, maxWait: 10_000 },
    );

    await this.audit.record({
      action: outcome.approved ? 'invoice.paid' : 'invoice.payment_declined',
      actorId: userId,
      targetType: 'invoice',
      targetId: invoiceId,
      ...(outcome.approved ? {} : { metadata: { failureCode: outcome.failureCode } }),
      ip,
    });
    if (!outcome.approved) throw new AppError(402, 'PAYMENT_DECLINED', 'Pagamento recusado', { failureCode: outcome.failureCode });
    return this.get(userId, invoiceId);
  }
}
