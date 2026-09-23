import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS } from '../../container/tokens.ts';
import type { Database } from '../../db/prisma.ts';
import type { VirtualizationProvider } from '../../integrations/virtualization/VirtualizationProvider.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import type { Clock } from '../../utils/clock.ts';
import { errorMessage, type JobContext, type JobHandler } from './types.ts';

const payloadSchema = z.object({ vpsId: z.string(), actorId: z.string().nullable().optional() });

/**
 * Exclusão (plano §11.4): para a VM se estiver ligada → DELETE com purge → IP FREE → faturas em aberto CANCELED →
 * DELETED (soft delete). O `destroy` do provider é idempotente, então uma nova tentativa não quebra.
 */
@injectable()
export class DeleteVpsHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
  ) {}

  async run(ctx: JobContext) {
    const { vpsId, actorId } = payloadSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: vpsId } });
    if (vps?.status !== 'DELETING') return;
    if (vps.pveVmid) await this.vms.destroy(vps.pveVmid);

    const now = this.clock.now();
    await this.db.$transaction(async (tx) => {
      if (vps.ipAddressId) await tx.ipAddress.update({ where: { id: vps.ipAddressId }, data: { status: 'FREE' } });
      await tx.invoice.updateMany({ where: { vpsId: vps.id, status: 'PENDING' }, data: { status: 'CANCELED' } });
      await tx.vps.update({
        where: { id: vps.id },
        data: { status: 'DELETED', deletedAt: now, pveVmid: null, ipAddressId: null, provisionSecrets: null, lastError: null },
      });
    });
    await this.notify.event(vps.id, 'delete', 'succeeded', { actorId: actorId ?? null });
    this.notify.status(vps, 'DELETED', null);
  }

  async onFinalFailure(ctx: JobContext, error: unknown) {
    const { vpsId, actorId } = payloadSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: vpsId } });
    if (vps?.status !== 'DELETING') return;
    await this.db.vps.updateMany({ where: { id: vps.id, status: 'DELETING' }, data: { status: 'ERROR', lastError: 'DELETE_FAILED' } });
    ctx.logger.error({ vpsId, err: errorMessage(error) }, 'exclusão da VPS falhou');
    await this.notify.event(vps.id, 'delete', 'failed', { actorId: actorId ?? null, message: 'DELETE_FAILED' });
    this.notify.status(vps, 'ERROR', 'DELETE_FAILED');
  }
}
