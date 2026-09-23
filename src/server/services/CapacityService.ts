import { inject, injectable } from 'tsyringe';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { VpsRepository } from '../repositories/VpsRepository.ts';
import { AppError } from '../utils/errors.ts';

const MB = 1024 * 1024;
const GB = 1024 ** 3;

/**
 * Controle de capacidade antes de aceitar um pedido (plano §11.5): limite de VPS por cliente, tetos configurados
 * (soma do que já foi reservado + o plano pedido) e os recursos livres REAIS do nó Proxmox.
 */
@injectable()
export class CapacityService {
  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(VpsRepository) private readonly vps: VpsRepository,
    @inject(TOKENS.VirtualizationProvider) private readonly virtualization: VirtualizationProvider,
  ) {}

  async assertCanAllocate(userId: string, plan: { memoryMb: number; diskGb: number }) {
    if ((await this.vps.countActiveForUser(userId)) >= this.env.MAX_VPS_PER_USER) {
      throw new AppError(409, 'VPS_LIMIT_REACHED', `Limite de ${this.env.MAX_VPS_PER_USER} VPS por cliente`, {
        limit: this.env.MAX_VPS_PER_USER,
      });
    }

    await this.assertResources(plan);
  }

  /** Troca de plano: só o ACRÉSCIMO de RAM e disco precisa caber (plano §11.4). */
  async assertCanGrow(delta: { memoryMb: number; diskGb: number }) {
    const grow = { memoryMb: Math.max(0, delta.memoryMb), diskGb: Math.max(0, delta.diskGb) };
    if (grow.memoryMb || grow.diskGb) await this.assertResources(grow);
  }

  private async assertResources(plan: { memoryMb: number; diskGb: number }) {
    const allocated = await this.vps.allocated();
    if (
      allocated.memoryMb + plan.memoryMb > this.env.CAPACITY_MAX_MEMORY_MB ||
      allocated.diskGb + plan.diskGb > this.env.CAPACITY_MAX_DISK_GB
    ) {
      throw new AppError(409, 'NO_CAPACITY', 'Sem estoque no momento');
    }

    let node: Awaited<ReturnType<VirtualizationProvider['capacity']>>;
    try {
      node = await this.virtualization.capacity();
    } catch {
      throw new AppError(503, 'PROXMOX_UNAVAILABLE', 'A infraestrutura está indisponível no momento');
    }
    // VPS pagas ou aguardando pagamento que ainda não existem no nó também vão ocupar memória.
    const freeMb = node.memFreeBytes / MB - allocated.memoryMbNotYetOnNode;
    if (plan.memoryMb > freeMb || plan.diskGb > node.storageAvailBytes / GB) {
      throw new AppError(409, 'NO_CAPACITY', 'Sem estoque no momento');
    }
  }
}
