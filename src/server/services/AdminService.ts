import { inject, injectable } from 'tsyringe';
import type { AdminJobDTO, AdminJobStatus, AdminOverviewDTO, AdminVpsDTO } from '../../shared/types/admin.ts';
import type { InvoiceKindDTO, VpsStatusDTO } from '../../shared/types/catalog.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { PERIODIC_JOB_TYPES } from '../jobs/handlers/MaintenanceHandlers.ts';
import { VpsRepository } from '../repositories/VpsRepository.ts';
import type { Clock } from '../utils/clock.ts';

const DAY = 86_400_000;
/** Tempo máximo esperando o Proxmox na visão geral: o resto da tela não pode ficar preso a ele. */
const NODE_TIMEOUT_MS = 3000;

/**
 * Visão administrativa (plano §17, Fase 10): capacidade do nó, contagens, fila de jobs e todas as VPS. Tudo somente
 * leitura; o payload dos jobs nunca sai daqui (pode ter senhas cifradas).
 */
@injectable()
export class AdminService {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsRepository) private readonly vps: VpsRepository,
  ) {}

  async overview(): Promise<AdminOverviewDTO> {
    const since = new Date(this.clock.now().getTime() - 30 * DAY);
    const [node, allocated, ips, ipsFree, users, roles, vps, pending, paid, jobs] = await Promise.all([
      Promise.race([
        this.vms.capacity().catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), NODE_TIMEOUT_MS).unref()),
      ]),
      this.vps.allocated(),
      this.db.ipAddress.count(),
      this.db.ipAddress.count({ where: { status: 'FREE' } }),
      this.db.user.groupBy({ by: ['roleId'], _count: { _all: true } }),
      this.db.role.findMany({ select: { id: true, key: true, name: true }, orderBy: { id: 'asc' } }),
      this.db.vps.groupBy({ by: ['status'], where: { status: { not: 'DELETED' } }, _count: { _all: true } }),
      this.db.invoice.aggregate({ where: { status: 'PENDING' }, _count: { _all: true }, _sum: { amountCents: true } }),
      this.db.invoice.aggregate({ where: { status: 'PAID', paidAt: { gte: since } }, _sum: { amountCents: true } }),
      this.db.job.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const perRole = new Map(users.map((u) => [u.roleId, u._count._all]));
    return {
      node: node
        ? {
            name: this.env.PVE_NODE,
            pveVersion: node.pveVersion,
            cpuCount: node.cpuCount,
            memTotalBytes: node.memTotalBytes,
            memAvailableBytes: node.memAvailableBytes,
            storageTotalBytes: node.storageTotalBytes,
            storageAvailBytes: node.storageAvailBytes,
          }
        : null,
      allocation: {
        memoryMb: allocated.memoryMb,
        diskGb: allocated.diskGb,
        maxMemoryMb: this.env.CAPACITY_MAX_MEMORY_MB,
        maxDiskGb: this.env.CAPACITY_MAX_DISK_GB,
        ipsFree,
        ipsTotal: ips,
      },
      users: roles.map((r) => ({ role: r.key, roleName: r.name, count: perRole.get(r.id) ?? 0 })),
      vps: vps.map((v) => ({ status: v.status as VpsStatusDTO, count: v._count._all })),
      billing: {
        pendingCount: pending._count._all,
        pendingCents: pending._sum.amountCents ?? 0,
        paidLast30DaysCents: paid._sum.amountCents ?? 0,
      },
      jobs: jobs.map((j) => ({ status: j.status as AdminJobStatus, count: j._count._all })),
    };
  }

  /** Últimos 50 jobs (por status; sem os periódicos, a não ser que peça), com a VPS a que se referem. Sem o payload. */
  async jobs(status?: AdminJobStatus, periodic = false): Promise<AdminJobDTO[]> {
    const rows = await this.db.job.findMany({
      where: { ...(status ? { status } : {}), ...(periodic ? {} : { type: { notIn: [...PERIODIC_JOB_TYPES] } }) },
      orderBy: { id: 'desc' },
      take: 50,
      select: {
        id: true,
        type: true,
        status: true,
        attempts: true,
        maxAttempts: true,
        runAt: true,
        updatedAt: true,
        lastError: true,
        payload: true,
      },
    });
    const vpsIdOf = (payload: unknown) => {
      const id = (payload as { vpsId?: unknown } | null)?.vpsId;
      return typeof id === 'string' ? id : null;
    };
    const ids = [...new Set(rows.map((r) => vpsIdOf(r.payload)).filter((id): id is string => id !== null))];
    const hostnames = new Map(
      (await this.db.vps.findMany({ where: { id: { in: ids } }, select: { id: true, hostname: true } })).map((v) => [v.id, v.hostname]),
    );
    return rows.map((r) => {
      const vpsId = vpsIdOf(r.payload);
      return {
        id: r.id,
        type: r.type,
        status: r.status as AdminJobStatus,
        attempts: r.attempts,
        maxAttempts: r.maxAttempts,
        runAt: r.runAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        lastError: r.lastError,
        vps: vpsId ? { id: vpsId, hostname: hostnames.get(vpsId) ?? '—' } : null,
      };
    });
  }

  /** Todas as VPS (somente leitura), com o dono; busca por hostname, IP ou e-mail do dono. */
  async listVps(query?: string, includeDeleted = false): Promise<AdminVpsDTO[]> {
    const q = query?.trim();
    const rows = await this.db.vps.findMany({
      where: {
        ...(includeDeleted ? {} : { deletedAt: null, status: { not: 'DELETED' } }),
        ...(q
          ? {
              OR: [
                { hostname: { contains: q } },
                { user: { email: { contains: q } } },
                { user: { name: { contains: q } } },
                { ipAddress: { address: { contains: q } } },
              ],
            }
          : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        plan: { select: { name: true } },
        osTemplate: { select: { name: true } },
        ipAddress: { select: { address: true } },
        invoices: { where: { status: 'PENDING' }, select: { kind: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((v) => ({
      id: v.id,
      hostname: v.hostname,
      status: v.status as VpsStatusDTO,
      owner: v.user,
      plan: v.plan.name,
      osTemplate: v.osTemplate.name,
      memoryMb: v.memoryMb,
      diskGb: v.diskGb,
      ip: v.ipAddress?.address ?? null,
      pveVmid: v.pveVmid,
      paidUntil: v.paidUntil?.toISOString() ?? null,
      lastError: v.status === 'ERROR' ? v.lastError : null,
      createdAt: v.createdAt.toISOString(),
      pendingInvoiceKind: (v.invoices[0]?.kind as InvoiceKindDTO | undefined) ?? null,
    }));
  }
}
