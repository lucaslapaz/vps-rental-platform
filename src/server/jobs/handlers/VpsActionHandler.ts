import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { POWER_ACTIONS, VPS_TRANSITIONS } from '../../../shared/constants/vps.ts';
import { TOKENS } from '../../container/tokens.ts';
import type { Database } from '../../db/prisma.ts';
import type { VirtualizationProvider, VmStatus } from '../../integrations/virtualization/VirtualizationProvider.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import { errorMessage, type JobContext, type JobHandler, PermanentJobError } from './types.ts';

const payloadSchema = z.object({ vpsId: z.string(), action: z.enum(POWER_ACTIONS), actorId: z.string().nullable().optional() });

/** Estado estável que corresponde ao estado real da VM. */
export function stableStatus(vm: VmStatus | null) {
  if (!vm) return null;
  return vm.status === 'running' ? ('RUNNING' as const) : vm.status === 'stopped' ? ('STOPPED' as const) : null;
}

/** start/shutdown/stop/reboot/reset (plano §11.4). O status final vem do estado REAL da VM depois da task. */
@injectable()
export class VpsActionHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
  ) {}

  async run(ctx: JobContext) {
    const { vpsId, action, actorId } = payloadSchema.parse(ctx.job.payload);
    const via = VPS_TRANSITIONS[action].via;
    const vps = await this.db.vps.findUnique({ where: { id: vpsId } });
    if (!vps || vps.status !== via) return; // outra operação assumiu (não deveria acontecer: a transição é exclusiva)
    if (!vps.pveVmid) throw new PermanentJobError('VPS sem VMID');

    const before = await this.vms.status(vps.pveVmid);
    if (!before) throw new PermanentJobError(`a VM ${vps.pveVmid} não existe`);
    // Idempotência: numa nova tentativa, não liga de novo o que já está ligado (nem desliga o que já está desligado).
    const alreadyDone =
      (action === 'start' && before.status === 'running') || ((action === 'shutdown' || action === 'stop') && before.status === 'stopped');
    if (!alreadyDone) await this.vms.power(vps.pveVmid, action);

    const final = stableStatus(await this.vms.status(vps.pveVmid));
    if (!final) throw new Error(`estado inesperado da VM ${vps.pveVmid} depois de ${action}`);
    const r = await this.db.vps.updateMany({ where: { id: vps.id, status: via }, data: { status: final, lastError: null } });
    if (r.count) {
      await this.notify.event(vps.id, action, 'succeeded', { actorId: actorId ?? null });
      this.notify.status(vps, final, null);
    }
  }

  async onFinalFailure(ctx: JobContext, error: unknown) {
    const { vpsId, action, actorId } = payloadSchema.parse(ctx.job.payload);
    const vps = await this.db.vps.findUnique({ where: { id: vpsId } });
    if (!vps || vps.status !== VPS_TRANSITIONS[action].via) return;
    // Volta para o estado real (a VM continua lá); se nem isso der para saber, ERROR.
    const real = vps.pveVmid ? stableStatus(await this.vms.status(vps.pveVmid).catch(() => null)) : null;
    const status = real ?? 'ERROR';
    await this.db.vps.updateMany({
      where: { id: vps.id, status: vps.status },
      data: { status, lastError: status === 'ERROR' ? 'ACTION_FAILED' : null },
    });
    ctx.logger.error({ vpsId, action, err: errorMessage(error) }, 'ação na VPS falhou');
    await this.notify.event(vps.id, action, 'failed', { actorId: actorId ?? null, message: 'ACTION_FAILED' });
    this.notify.status(vps, status, status === 'ERROR' ? 'ACTION_FAILED' : null);
  }
}
