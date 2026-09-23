import { inject, injectable } from 'tsyringe';
import type { VpsDTO, VpsStatusDTO } from '../../shared/types/catalog.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

export const vpsInclude = {
  plan: { select: { slug: true, name: true } },
  osTemplate: { select: { slug: true, name: true, family: true, sudoCommand: true, hasGui: true, pveTemplateVmid: true } },
  ipAddress: { select: { address: true, prefix: true, gateway: true, macAddress: true } },
  invoices: { where: { status: 'PENDING' as const }, select: { id: true }, orderBy: { createdAt: 'desc' as const }, take: 1 },
} as const;

type VpsRow = NonNullable<Awaited<ReturnType<VpsRepository['findOwned']>>>;

export function toVpsDTO(v: VpsRow): VpsDTO {
  return {
    id: v.id,
    hostname: v.hostname,
    username: v.username,
    status: v.status as VpsStatusDTO,
    plan: v.plan,
    osTemplate: {
      slug: v.osTemplate.slug,
      name: v.osTemplate.name,
      family: v.osTemplate.family,
      sudoCommand: v.osTemplate.sudoCommand,
      hasGui: v.osTemplate.hasGui,
    },
    cores: v.cores,
    memoryMb: v.memoryMb,
    diskGb: v.diskGb,
    bandwidthMbps: v.bandwidthMbps,
    ip: v.ipAddress?.address ?? null,
    sshPasswordAuth: v.sshPasswordAuth,
    rootPasswordSet: v.rootPasswordSet,
    lastError: v.status === 'ERROR' ? v.lastError : null,
    createdAt: v.createdAt.toISOString(),
    pendingInvoiceId: v.invoices[0]?.id ?? null,
  };
}

@injectable()
export class VpsRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  listForUser(userId: string) {
    return this.db.vps.findMany({
      where: { userId, deletedAt: null, status: { not: 'DELETED' } },
      include: vpsInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Só devolve se a VPS for do usuário (a checagem de propriedade fica no WHERE; outra pessoa recebe 404). */
  findOwned(id: string, userId: string) {
    return this.db.vps.findFirst({ where: { id, userId, deletedAt: null }, include: vpsInclude });
  }

  /** Recursos reservados por VPS que ainda existem ou vão existir (inclui as que aguardam pagamento). */
  async allocated() {
    const agg = await this.db.vps.aggregate({
      where: { deletedAt: null, status: { notIn: ['DELETED'] } },
      _sum: { memoryMb: true, diskGb: true },
      _count: { _all: true },
    });
    const notYetOnNode = await this.db.vps.aggregate({
      where: { deletedAt: null, status: { in: ['PENDING_PAYMENT', 'PROVISIONING'] } },
      _sum: { memoryMb: true },
    });
    return {
      memoryMb: agg._sum.memoryMb ?? 0,
      diskGb: agg._sum.diskGb ?? 0,
      count: agg._count._all,
      memoryMbNotYetOnNode: notYetOnNode._sum.memoryMb ?? 0,
    };
  }

  countActiveForUser(userId: string) {
    return this.db.vps.count({ where: { userId, deletedAt: null, status: { not: 'DELETED' } } });
  }
}
