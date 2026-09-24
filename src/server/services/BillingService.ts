import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import type { payInvoiceSchema } from '../../shared/schemas/vps.ts';
import type { InvoiceDTO, InvoiceKindDTO, VpsStatusDTO } from '../../shared/types/catalog.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { PaymentGateway } from '../integrations/payment/PaymentGateway.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { AppError } from '../utils/errors.ts';
import { billingDurations } from './billingPeriods.ts';
import { VpsNotifier } from './VpsNotifier.ts';

type PayInput = import('zod').output<typeof payInvoiceSchema>;

type InvoiceRow = {
  id: string;
  number: number;
  kind: string;
  description: string;
  amountCents: number;
  status: string;
  periodStart: Date | null;
  periodEnd: Date | null;
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
    kind: i.kind as InvoiceKindDTO,
    description: i.description,
    amountCents: i.amountCents,
    currency: 'BRL',
    periodStart: i.periodStart?.toISOString() ?? null,
    periodEnd: i.periodEnd?.toISOString() ?? null,
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
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
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
          {
            id: string;
            status: string;
            kind: string;
            amountCents: number;
            dueAt: Date;
            periodEnd: Date | null;
            vpsId: string | null;
            description: string;
          }[]
        >`
          SELECT id, status, kind, amountCents, dueAt, periodEnd, vpsId, description FROM invoices WHERE id = ${invoiceId} AND userId = ${userId} FOR UPDATE`;
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
        if (result.status === 'DECLINED') return { approved: false as const, failureCode: result.failureCode, reactivated: null };

        const now = this.clock.now();
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: now } });
        let reactivated: { id: string; userId: string } | null = null;
        if (locked.vpsId && locked.kind === 'RENEWAL' && locked.periodEnd) {
          // Renovação: estende o período pago; se a VPS estava suspensa por falta de pagamento, liga de novo.
          const vps = await tx.vps.findUniqueOrThrow({ where: { id: locked.vpsId }, select: { status: true, paidUntil: true } });
          const periodEnd = new Date(locked.periodEnd);
          const paidUntil = vps.paidUntil && vps.paidUntil > periodEnd ? vps.paidUntil : periodEnd;
          await tx.vps.update({ where: { id: locked.vpsId }, data: { paidUntil } });
          await tx.vpsEvent.create({ data: { vpsId: locked.vpsId, actorId: userId, action: 'renewal', status: 'succeeded' } });
          if (vps.status === 'SUSPENDED') {
            await tx.vps.update({ where: { id: locked.vpsId }, data: { status: 'STARTING' } });
            await tx.job.create({ data: { type: 'vps_action', payload: { vpsId: locked.vpsId, action: 'start', actorId: userId } } });
            reactivated = { id: locked.vpsId, userId };
          }
        } else if (locked.vpsId) {
          const vps = await tx.vps.findUniqueOrThrow({ where: { id: locked.vpsId }, select: { status: true, provisionSecrets: true } });
          if (vps.status === 'PENDING_PAYMENT') {
            // O 1º período começa no pagamento (o relógio acelerado encurta os prazos na demonstração).
            const paidUntil = new Date(now.getTime() + billingDurations(this.env).periodMs);
            await tx.vps.update({ where: { id: locked.vpsId }, data: { status: 'PROVISIONING', provisionSecrets: null, paidUntil } });
            await tx.job.create({ data: { type: 'provision_vps', payload: { vpsId: locked.vpsId, secrets: vps.provisionSecrets } } });
            await tx.vpsEvent.create({ data: { vpsId: locked.vpsId, actorId: userId, action: 'payment', status: 'succeeded' } });
          }
        }
        return { approved: true as const, reactivated };
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
    if (outcome.reactivated) this.notify.status(outcome.reactivated, 'STARTING', null);
    if (!outcome.approved) throw new AppError(402, 'PAYMENT_DECLINED', 'Pagamento recusado', { failureCode: outcome.failureCode });
    return this.get(userId, invoiceId);
  }
}
