import { inject, injectable } from 'tsyringe';
import type { ProvisionStep } from '../../shared/constants/events.ts';
import type { VpsStatusDTO } from '../../shared/types/catalog.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { RealtimeHub } from '../realtime/RealtimeEmitter.ts';
import type { Clock } from '../utils/clock.ts';

/**
 * Histórico visível ao cliente (VpsEvent) + eventos em tempo real (plano §13.2 e §14.5). As etapas da criação ficam
 * gravadas, então a linha do tempo se reconstrói mesmo depois de recarregar a página.
 */
@injectable()
export class VpsNotifier {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Realtime) private readonly realtime: RealtimeHub,
    @inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  status(vps: { id: string; userId: string }, status: VpsStatusDTO, lastError?: string | null) {
    this.realtime.toUser(vps.userId, 'vps:status', { vpsId: vps.id, status, ...(lastError === undefined ? {} : { lastError }) });
  }

  async progress(vps: { id: string; userId: string }, step: ProvisionStep) {
    const at = this.clock.now();
    await this.db.vpsEvent.create({ data: { vpsId: vps.id, action: 'provision', status: 'progress', message: step, createdAt: at } });
    this.realtime.toUser(vps.userId, 'vps:progress', { vpsId: vps.id, step, at: at.toISOString() });
  }

  event(
    vpsId: string,
    action: string,
    status: 'requested' | 'succeeded' | 'failed',
    extra: { actorId?: string | null; message?: string; pveUpid?: string } = {},
  ) {
    return this.db.vpsEvent.create({
      data: {
        vpsId,
        action,
        status,
        actorId: extra.actorId ?? null,
        message: extra.message?.slice(0, 5000) ?? null,
        pveUpid: extra.pveUpid ?? null,
      },
    });
  }
}
