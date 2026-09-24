import { z } from 'zod';
import type { Env } from '../../src/server/config/env.ts';
import type { Database } from '../../src/server/db/prisma.ts';
import type { ProxmoxClient } from '../../src/server/integrations/proxmox/ProxmoxClient.ts';
import type { VirtualizationProvider } from '../../src/server/integrations/virtualization/VirtualizationProvider.ts';

/** UPID de task do Proxmox (ex.: UPID:primeiro:0000ABCD:...:qmstart:2000:user@realm!token:). */
export const UPID_PATTERN = /^UPID:[A-Za-z0-9.-]+:[0-9A-F]{8}:[0-9A-F]{8}:[0-9A-F]{8}:[a-z]+:[^:]*:[^:]+:$/;

/**
 * Consultas SOMENTE LEITURA ao Proxmox e ao banco (plano §16.3), com o token restrito aos pools da plataforma. Usadas
 * pelo CLI `npm run pve` e pelo MCP da Favo; nenhuma delas altera nada.
 */
export class PlatformInspector {
  constructor(
    private readonly env: Pick<Env, 'PVE_NODE' | 'PVE_POOL' | 'PVE_STORAGE' | 'PVE_URL'>,
    private readonly provider: VirtualizationProvider,
    private readonly api: Pick<ProxmoxClient, 'get'>,
    private readonly db: Database,
  ) {}

  async capacity() {
    const c = await this.provider.capacity();
    return { node: this.env.PVE_NODE, storage: this.env.PVE_STORAGE, ...c };
  }

  /** VMs do pool da plataforma, com o estado de cada uma e a VPS do banco a que pertencem. */
  async instances() {
    const vmids = (await this.provider.listManagedVmids()).sort((a, b) => a - b);
    const owners = new Map(
      (
        await this.db.vps.findMany({
          where: { pveVmid: { in: vmids } },
          select: { pveVmid: true, id: true, hostname: true, status: true },
        })
      ).map((v) => [v.pveVmid as number, v]),
    );
    const list = [];
    for (const vmid of vmids) {
      const s = await this.provider.status(vmid);
      const vps = owners.get(vmid);
      list.push({
        vmid,
        name: s?.name ?? null,
        status: s?.status ?? 'unknown',
        memMaxBytes: s?.memMaxBytes ?? 0,
        diskMaxBytes: s?.diskMaxBytes ?? 0,
        uptimeSeconds: s?.uptimeSeconds ?? 0,
        vps: vps ? { id: vps.id, hostname: vps.hostname, status: vps.status } : null,
      });
    }
    return list;
  }

  /** Estado de uma VM (null se não existir ou estiver fora dos pools do token) e as alterações pendentes. */
  async instance(vmid: number) {
    const s = await this.provider.status(vmid);
    if (!s) return null;
    return { ...s, pending: await this.provider.pendingChanges(vmid) };
  }

  /** Estado e as últimas linhas do log de uma task (UPID). */
  async task(upid: string, limit = 50) {
    if (!UPID_PATTERN.test(upid)) throw new Error('UPID inválido');
    const path = `/nodes/${this.env.PVE_NODE}/tasks/${encodeURIComponent(upid)}`;
    const status = await this.api.get(`${path}/status`, z.record(z.string(), z.unknown()));
    const log = await this.api.get(`${path}/log`, z.array(z.object({ n: z.number(), t: z.string() })), { start: 0, limit });
    return { status, log: log.map((l) => l.t) };
  }

  /** Pool do Proxmox × tabela `vps` (só o relatório; a correção automática é o job reconcile). */
  async reconcileReport() {
    const inPool = new Set(await this.provider.listManagedVmids());
    const inDb = await this.db.vps.findMany({
      where: { pveVmid: { not: null }, deletedAt: null },
      select: { id: true, hostname: true, pveVmid: true, status: true },
    });
    const dbVmids = new Set(inDb.map((v) => v.pveVmid as number));
    return {
      pool: this.env.PVE_POOL,
      vmsInPool: inPool.size,
      vpsWithVmid: inDb.length,
      orphanVmids: [...inPool].filter((v) => !dbVmids.has(v)).sort((a, b) => a - b),
      vpsWithoutVm: inDb.filter((v) => !inPool.has(v.pveVmid as number)),
    };
  }
}
