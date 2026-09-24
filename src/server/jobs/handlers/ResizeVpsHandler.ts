import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import type { Database } from '../../db/prisma.ts';
import type { VirtualizationProvider } from '../../integrations/virtualization/VirtualizationProvider.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import type { Clock } from '../../utils/clock.ts';
import { errorMessage, type JobContext, type JobHandler, PermanentJobError } from './types.ts';
import { stableStatus } from './VpsActionHandler.ts';

const GB = 1024 ** 3;

const payloadSchema = z.object({
  vpsId: z.string(),
  actorId: z.string().nullable().optional(),
  planId: z.number().int(),
  cores: z.number().int(),
  memoryMb: z.number().int(),
  diskGb: z.number().int(),
  bandwidthMbps: z.number().int(),
  previousStatus: z.enum(['RUNNING', 'STOPPED']),
  /** Diferença proporcional (simulada), calculada no pedido; 0 = sem fatura. */
  amountCents: z.number().int().min(0),
  description: z.string(),
});

/**
 * Troca de plano (plano §11.4): CPU/RAM/banda pelo `config` e disco pelo `resize` (só aumenta). Com a VM ligada, CPU e
 * RAM ficam pendentes até reiniciar pelo painel (o `reboot` da API aplica as pendências; o de dentro da VM, não).
 */
@injectable()
export class ResizeVpsHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
  ) {}

  async run(ctx: JobContext) {
    const p = payloadSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: p.vpsId }, include: { ipAddress: true } });
    if (vps?.status !== 'UPDATING') return;
    if (!vps.pveVmid || !vps.ipAddress) throw new PermanentJobError('VPS sem VMID ou sem IP');

    await this.vms.updateResources(
      vps.pveVmid,
      { cores: p.cores, memoryMb: p.memoryMb, bandwidthMbps: p.bandwidthMbps },
      vps.ipAddress.macAddress,
    );
    const current = await this.vms.status(vps.pveVmid);
    if (!current) throw new PermanentJobError(`a VM ${vps.pveVmid} não existe`);
    let diskGrowPending = vps.diskGrowPending;
    if (current.diskMaxBytes < p.diskGb * GB) {
      await this.vms.resizeDisk(vps.pveVmid, p.diskGb);
      diskGrowPending = true;
    }
    // O cloud-init está congelado (C23): a raiz é expandida pelo agente. Desligada, fica para o próximo "Ligar".
    if (diskGrowPending && current.status === 'running') {
      try {
        await this.vms.waitForAgent(vps.pveVmid, 60_000);
        await this.vms.growRootFs(vps.pveVmid);
        diskGrowPending = false;
      } catch (err) {
        ctx.logger.warn({ vpsId: vps.id, err: errorMessage(err) }, 'não foi possível expandir a raiz agora; fica para o próximo start');
      }
    }
    const pendingReboot = current.status === 'running' && (await this.vms.pendingChanges(vps.pveVmid)).length > 0;
    const status = stableStatus(current) ?? p.previousStatus;

    const now = this.clock.now();
    await this.db.$transaction(async (tx) => {
      await tx.vps.update({
        where: { id: vps.id },
        data: {
          planId: p.planId,
          cores: p.cores,
          memoryMb: p.memoryMb,
          diskGb: p.diskGb,
          bandwidthMbps: p.bandwidthMbps,
          status,
          lastError: null,
          diskGrowPending,
        },
      });
      if (p.amountCents > 0) {
        await tx.invoice.create({
          data: {
            userId: vps.userId,
            vpsId: vps.id,
            kind: 'UPGRADE',
            description: p.description,
            amountCents: p.amountCents,
            dueAt: new Date(now.getTime() + this.env.INVOICE_DUE_HOURS * 3_600_000),
          },
        });
      }
    });
    await this.notify.event(vps.id, 'resize', 'succeeded', {
      actorId: p.actorId ?? null,
      ...(pendingReboot ? { message: 'PENDING_REBOOT' } : {}),
    });
    this.notify.status(vps, status, null);
  }

  async onFinalFailure(ctx: JobContext, error: unknown) {
    const p = payloadSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: p.vpsId } });
    if (vps?.status !== 'UPDATING') return;
    const real = vps.pveVmid ? stableStatus(await this.vms.status(vps.pveVmid).catch(() => null)) : null;
    const status = real ?? 'ERROR';
    await this.db.vps.updateMany({
      where: { id: vps.id, status: 'UPDATING' },
      data: { status, lastError: status === 'ERROR' ? 'RESIZE_FAILED' : null },
    });
    ctx.logger.error({ vpsId: vps.id, err: errorMessage(error) }, 'troca de plano falhou');
    await this.notify.event(vps.id, 'resize', 'failed', { actorId: p.actorId ?? null, message: 'RESIZE_FAILED' });
    this.notify.status(vps, status, status === 'ERROR' ? 'RESIZE_FAILED' : null);
  }
}
