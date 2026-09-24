import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import type { Database } from '../../db/prisma.ts';
import type { VirtualizationProvider } from '../../integrations/virtualization/VirtualizationProvider.ts';
import { billingDurations } from '../../services/billingPeriods.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import type { Clock } from '../../utils/clock.ts';
import { JobQueue } from '../JobQueue.ts';
import type { JobContext, JobHandler } from './types.ts';

/** Estados em que a VPS existe (ou vai existir) e continua sendo cobrada. */
const BILLABLE = ['PROVISIONING', 'RUNNING', 'STOPPED', 'STARTING', 'STOPPING', 'REBOOTING', 'UPDATING', 'SUSPENDED', 'ERROR'] as const;

/**
 * Ciclo da cobrança recorrente (plano §12, Fase 10), a cada minuto. Tudo é contado a partir de `Vps.paidUntil`:
 * 1. `paidUntil - aviso`: gera a fatura de renovação (período seguinte, vence no fim da carência);
 * 2. `paidUntil` vencido: VPS SUSPENDED e a VM é desligada (job suspend_vps);
 * 3. `paidUntil + carência` vencido: exclusão (o mesmo delete_vps do cliente, que também cancela a fatura em aberto).
 * Pagar a renovação estende o `paidUntil` e, se a VPS estiver suspensa, liga de novo (BillingService.pay).
 * Cada passo é idempotente e usa lock otimista, então rodar de novo (ou junto com um pagamento) não duplica nada.
 */
@injectable()
export class BillingCycleHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(JobQueue) private readonly queue: JobQueue,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
  ) {}

  async run(ctx: JobContext) {
    const now = this.clock.now();
    const { periodMs, noticeMs, graceMs } = billingDurations(this.env);
    const renewed = await this.createRenewals(now, periodMs, noticeMs, graceMs);
    const suspended = await this.suspendOverdue(now);
    const deleted = await this.deleteExpired(new Date(now.getTime() - graceMs));
    if (renewed || suspended || deleted) ctx.logger.info({ renewed, suspended, deleted }, 'ciclo de cobrança');
  }

  private async createRenewals(now: Date, periodMs: number, noticeMs: number, graceMs: number) {
    const due = await this.db.vps.findMany({
      where: { deletedAt: null, status: { in: [...BILLABLE] }, paidUntil: { lte: new Date(now.getTime() + noticeMs) } },
      select: { id: true, userId: true, hostname: true, status: true, paidUntil: true, plan: { select: { name: true, priceCents: true } } },
    });
    let count = 0;
    for (const vps of due) {
      const start = vps.paidUntil as Date;
      const created = await this.db.$transaction(async (tx) => {
        // Uma fatura por período: a de renovação do período que começa no paidUntil atual.
        const existing = await tx.invoice.findFirst({
          where: { vpsId: vps.id, kind: 'RENEWAL', periodStart: start, status: { in: ['PENDING', 'PAID'] } },
          select: { id: true },
        });
        if (existing) return false;
        await tx.invoice.create({
          data: {
            userId: vps.userId,
            vpsId: vps.id,
            kind: 'RENEWAL',
            description: `VPS ${vps.hostname} — plano ${vps.plan.name}, renovação`,
            amountCents: vps.plan.priceCents,
            periodStart: start,
            periodEnd: new Date(start.getTime() + periodMs),
            dueAt: new Date(start.getTime() + graceMs),
          },
        });
        return true;
      });
      if (!created) continue;
      count++;
      await this.notify.event(vps.id, 'renewal_invoice', 'succeeded');
      this.notify.status(vps, vps.status); // o cliente recarrega a VPS e passa a ver a fatura em aberto
    }
    return count;
  }

  private async suspendOverdue(now: Date) {
    const overdue = await this.db.vps.findMany({
      where: { deletedAt: null, status: { in: ['RUNNING', 'STOPPED'] }, paidUntil: { lt: now } },
      select: { id: true, userId: true, status: true },
    });
    let count = 0;
    for (const vps of overdue) {
      const moved = await this.db.$transaction(async (tx) => {
        // Lock otimista também no paidUntil: um pagamento que entrou agora ganha da suspensão.
        const r = await tx.vps.updateMany({
          where: { id: vps.id, status: vps.status, paidUntil: { lt: now } },
          data: { status: 'SUSPENDED' },
        });
        if (!r.count) return false;
        await this.queue.enqueue('suspend_vps', { vpsId: vps.id }, { tx, maxAttempts: 5 });
        await tx.vpsEvent.create({ data: { vpsId: vps.id, action: 'suspend', status: 'succeeded', message: 'OVERDUE' } });
        return true;
      });
      if (!moved) continue;
      count++;
      this.notify.status(vps, 'SUSPENDED', null);
    }
    return count;
  }

  private async deleteExpired(limit: Date) {
    const expired = await this.db.vps.findMany({
      where: { deletedAt: null, status: { in: ['SUSPENDED', 'ERROR'] }, paidUntil: { lt: limit } },
      select: { id: true, userId: true, status: true },
    });
    let count = 0;
    for (const vps of expired) {
      const moved = await this.db.$transaction(async (tx) => {
        const r = await tx.vps.updateMany({
          where: { id: vps.id, status: vps.status, paidUntil: { lt: limit } },
          data: { status: 'DELETING' },
        });
        if (!r.count) return false;
        await this.queue.enqueue('delete_vps', { vpsId: vps.id, actorId: null }, { tx });
        await tx.vpsEvent.create({ data: { vpsId: vps.id, action: 'delete', status: 'requested', message: 'OVERDUE' } });
        return true;
      });
      if (!moved) continue;
      count++;
      this.notify.status(vps, 'DELETING', null);
    }
    return count;
  }
}

const suspendSchema = z.object({ vpsId: z.string() });

/**
 * Desliga a VM de uma VPS suspensa (ACPI, com queda para "stop" no provider). Idempotente: se a VPS já foi reativada
 * (pagamento) ou a VM já está desligada, não faz nada. Enquanto SUSPENDED, o reconcile não mexe no status.
 */
@injectable()
export class SuspendVpsHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
  ) {}

  async run(ctx: JobContext) {
    const { vpsId } = suspendSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: vpsId }, select: { status: true, pveVmid: true } });
    if (vps?.status !== 'SUSPENDED' || !vps.pveVmid) return;
    const current = await this.vms.status(vps.pveVmid);
    if (current?.status === 'running') await this.vms.power(vps.pveVmid, 'shutdown');
  }
}
