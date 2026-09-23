import { inject, injectable } from 'tsyringe';
import type { VpsLiveDTO, VpsMetricPointDTO } from '../../shared/types/catalog.ts';
import { TOKENS } from '../container/tokens.ts';
import type { MetricsTimeframe, VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { VpsRepository } from '../repositories/VpsRepository.ts';
import type { Clock } from '../utils/clock.ts';
import { AppError } from '../utils/errors.ts';

const LIVE_TTL_MS = 5_000;
const METRICS_TTL_MS = 30_000;

/**
 * Leituras síncronas do Proxmox para a página da VPS (plano §11.4): estado ao vivo e gráficos do rrddata. Um cache
 * curto por VPS evita uma chamada ao Proxmox por aba aberta a cada atualização.
 */
@injectable()
export class VpsInsightsService {
  private readonly cache = new Map<string, { at: number; value: unknown }>();

  constructor(
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsRepository) private readonly vps: VpsRepository,
  ) {}

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < ttl) return hit.value as T;
    const value = await load();
    this.cache.set(key, { at: now, value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }

  private async vmidOf(userId: string, vpsId: string) {
    const found = await this.vps.findOwned(vpsId, userId);
    if (!found || found.status === 'DELETED') throw AppError.notFound('VPS não encontrada');
    return found.pveVmid;
  }

  async live(userId: string, vpsId: string): Promise<VpsLiveDTO | null> {
    const vmid = await this.vmidOf(userId, vpsId);
    if (!vmid) return null;
    return this.cached(`live:${vpsId}`, LIVE_TTL_MS, async () => {
      const s = await this.vms.status(vmid);
      if (!s) return null;
      const running = s.status === 'running';
      const [disk, pending] = running ? await Promise.all([this.vms.guestDiskUsage(vmid), this.vms.pendingChanges(vmid)]) : [null, []];
      return {
        power: s.status,
        uptimeSeconds: s.uptimeSeconds,
        cpu: s.cpu,
        cpus: s.cpus,
        memUsedBytes: s.memUsedBytes,
        memMaxBytes: s.memMaxBytes,
        disk,
        diskMaxBytes: s.diskMaxBytes,
        // Só CPU/RAM exigem reiniciar; o net0 (banda) é aplicado na hora (CLAUDE.md C20).
        pendingReboot: pending.some((p) => p.key === 'memory' || p.key === 'cores' || p.key === 'sockets'),
      };
    });
  }

  async metrics(userId: string, vpsId: string, timeframe: MetricsTimeframe): Promise<VpsMetricPointDTO[]> {
    const vmid = await this.vmidOf(userId, vpsId);
    if (!vmid) return [];
    return this.cached(`metrics:${vpsId}:${timeframe}`, METRICS_TTL_MS, async () =>
      (await this.vms.metrics(vmid, timeframe)).map((p) => ({
        time: p.time,
        cpu: p.cpu ?? null,
        memUsed: p.memUsed ?? null,
        memMax: p.memMax ?? null,
        netIn: p.netIn ?? null,
        netOut: p.netOut ?? null,
      })),
    );
  }

  /** Depois de uma ação que muda o estado, a próxima leitura vai ao Proxmox. */
  invalidate(vpsId: string) {
    for (const key of this.cache.keys()) if (key.includes(vpsId)) this.cache.delete(key);
  }
}
