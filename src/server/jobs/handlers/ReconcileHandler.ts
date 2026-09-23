import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../container/tokens.ts';
import type { Database } from '../../db/prisma.ts';
import type { VirtualizationProvider } from '../../integrations/virtualization/VirtualizationProvider.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import type { JobContext, JobHandler } from './types.ts';
import { stableStatus } from './VpsActionHandler.ts';

/**
 * Reconciliação periódica banco ↔ Proxmox (plano §11.5). Só mexe em VPS em estado ESTÁVEL (RUNNING/STOPPED): as que
 * estão em transição pertencem a um job. Corrige o status se alguém ligou/desligou pela interface web do Proxmox,
 * marca ERROR se a VM sumiu e só REGISTRA (sem apagar) VMs do pool que o banco não conhece.
 */
@injectable()
export class ReconcileHandler implements JobHandler {
  /** Órfãs já registradas neste processo (para não repetir o aviso a cada minuto). */
  private readonly reportedOrphans = new Set<number>();

  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
  ) {}

  async run(ctx: JobContext) {
    const managed = new Set(await this.vms.listManagedVmids());
    const known = await this.db.vps.findMany({
      where: { deletedAt: null, pveVmid: { not: null } },
      select: { id: true, userId: true, status: true, pveVmid: true },
    });

    let changed = 0;
    for (const vps of known) {
      if (vps.status !== 'RUNNING' && vps.status !== 'STOPPED') continue;
      const vmid = vps.pveVmid as number;
      const next = managed.has(vmid) ? stableStatus(await this.vms.status(vmid)) : 'ERROR';
      if (!next || next === vps.status) continue;
      // Lock otimista: se o cliente pediu uma ação neste meio-tempo, o status já mudou e nada é sobrescrito.
      const r = await this.db.vps.updateMany({
        where: { id: vps.id, status: vps.status },
        data: { status: next, lastError: next === 'ERROR' ? 'VM_MISSING' : null },
      });
      if (!r.count) continue;
      changed++;
      await this.notify.event(vps.id, 'reconcile', 'succeeded', { message: `${vps.status}→${next}` });
      this.notify.status(vps, next, next === 'ERROR' ? 'VM_MISSING' : null);
    }

    const knownVmids = new Set(known.map((v) => v.pveVmid));
    for (const vmid of managed) {
      if (knownVmids.has(vmid) || this.reportedOrphans.has(vmid)) continue;
      this.reportedOrphans.add(vmid);
      ctx.logger.warn({ vmid }, 'reconcile: VM no pool da plataforma sem VPS correspondente no banco (não foi apagada)');
    }
    if (changed) ctx.logger.info({ changed }, 'reconcile: status corrigidos');
  }
}
