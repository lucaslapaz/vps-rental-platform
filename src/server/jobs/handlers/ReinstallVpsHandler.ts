import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { TOKENS } from '../../container/tokens.ts';
import type { Database } from '../../db/prisma.ts';
import type { VirtualizationProvider } from '../../integrations/virtualization/VirtualizationProvider.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import { ProvisionVpsHandler } from './ProvisionVpsHandler.ts';
import { errorMessage, type JobContext, type JobHandler } from './types.ts';

const payloadSchema = z.object({
  vpsId: z.string(),
  /** A VM antiga já foi apagada (checkpoint): numa nova tentativa, não apaga a que o provisionamento acabou de clonar. */
  wiped: z.boolean().optional(),
  cloneStarted: z.boolean().optional(),
});

/**
 * Reinstalar (plano §17, Fase 10): apaga a VM antiga e segue o MESMO provisionamento da criação, que reaproveita o IP
 * (o `IpamService.reserveFor` devolve o que a VPS já tem), o MAC derivado dele e o VMID. Cada passo é retomável.
 */
@injectable()
export class ReinstallVpsHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
    @inject(ProvisionVpsHandler) private readonly provision: ProvisionVpsHandler,
  ) {}

  async run(ctx: JobContext) {
    const p = payloadSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: p.vpsId }, select: { id: true, userId: true, status: true, pveVmid: true } });
    if (vps?.status !== 'PROVISIONING') {
      ctx.logger.warn({ vpsId: p.vpsId, status: vps?.status }, 'reinstall_vps: a VPS não está mais em PROVISIONING');
      await ctx.save({ secrets: null });
      return;
    }
    if (!p.wiped) {
      await this.notify.progress({ id: vps.id, userId: vps.userId }, 'wiping');
      if (vps.pveVmid) await this.vms.destroy(vps.pveVmid); // idempotente; desliga antes se estiver ligada
      await ctx.save({ wiped: true, reinstall: true });
    }
    await this.provision.run(ctx);
  }

  /**
   * Falha definitiva: apaga a VM parcial (se o clone chegou a começar) e marca ERROR, mas MANTÉM o IP da VPS, para uma
   * nova tentativa de reinstalação sair com o mesmo endereço. Excluir a VPS devolve o IP ao pool.
   */
  async onFinalFailure(ctx: JobContext, error: unknown) {
    await ctx.save({ secrets: null });
    const p = payloadSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: p.vpsId } });
    if (vps?.status !== 'PROVISIONING') return;
    let vmGone = !vps.pveVmid;
    if (vps.pveVmid) {
      try {
        const current = await this.vms.status(vps.pveVmid);
        if (current && (p.cloneStarted || !p.wiped) && current.name === vps.hostname) await this.vms.destroy(vps.pveVmid);
        vmGone = !(await this.vms.status(vps.pveVmid));
      } catch (err) {
        ctx.logger.error(
          { err: errorMessage(err), vmid: vps.pveVmid },
          'não foi possível apagar a VM parcial; o reconcile vai registrá-la',
        );
      }
    }
    await this.db.vps.updateMany({
      where: { id: vps.id, status: 'PROVISIONING' },
      data: { status: 'ERROR', lastError: 'REINSTALL_FAILED', ...(vmGone ? { pveVmid: null } : {}) },
    });
    ctx.logger.error({ vpsId: vps.id, err: errorMessage(error) }, 'reinstalação falhou de vez');
    await this.notify.event(vps.id, 'reinstall', 'failed', { message: 'REINSTALL_FAILED' });
    this.notify.status({ id: vps.id, userId: vps.userId }, 'ERROR', 'REINSTALL_FAILED');
  }
}
