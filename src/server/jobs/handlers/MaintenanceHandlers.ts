import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../../container/tokens.ts';
import type { Database } from '../../db/prisma.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import type { Clock } from '../../utils/clock.ts';
import type { JobContext, JobHandler } from './types.ts';

const DAY = 86_400_000;

/** Jobs que o worker agenda sozinho (JobWorker.schedulePeriodic). */
export const PERIODIC_JOB_TYPES = ['reconcile', 'expire_pending', 'cleanup_sessions', 'billing_cycle'] as const;

/**
 * Faturas vencidas e não pagas são canceladas (plano §12). Se era a fatura de criação, a VPS que aguardava pagamento
 * vira DELETED (nada foi criado no Proxmox) e as senhas cifradas do pedido são apagadas.
 */
@injectable()
export class ExpirePendingHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
  ) {}

  async run(ctx: JobContext) {
    const now = this.clock.now();
    const expired = await this.db.invoice.findMany({ where: { status: 'PENDING', dueAt: { lt: now } }, select: { id: true, vpsId: true } });
    for (const invoice of expired) {
      const vps = await this.db.$transaction(async (tx) => {
        const r = await tx.invoice.updateMany({ where: { id: invoice.id, status: 'PENDING' }, data: { status: 'CANCELED' } });
        if (!r.count || !invoice.vpsId) return null;
        const v = await tx.vps.updateMany({
          where: { id: invoice.vpsId, status: 'PENDING_PAYMENT' },
          data: { status: 'DELETED', deletedAt: now, provisionSecrets: null },
        });
        return v.count ? tx.vps.findUnique({ where: { id: invoice.vpsId }, select: { id: true, userId: true } }) : null;
      });
      if (vps) {
        await this.notify.event(vps.id, 'expire', 'succeeded');
        this.notify.status(vps, 'DELETED', null);
      }
    }
    if (expired.length) ctx.logger.info({ count: expired.length }, 'faturas vencidas canceladas');
  }
}

/**
 * Limpeza: sessões expiradas/revogadas há mais de 1 dia; jobs periódicos concluídos há mais de 1 hora (o reconcile
 * sozinho gera ~1.440 por dia) ou com falha há mais de 1 dia, e os demais concluídos há mais de 7 dias.
 */
@injectable()
export class CleanupHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  async run(ctx: JobContext) {
    const now = this.clock.now().getTime();
    const dayAgo = new Date(now - DAY);
    const sessions = await this.db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: dayAgo } }, { absoluteExpiresAt: { lt: dayAgo } }, { revokedAt: { lt: dayAgo } }] },
    });
    const jobs = await this.db.job.deleteMany({
      where: {
        OR: [
          { status: 'SUCCEEDED', type: { in: [...PERIODIC_JOB_TYPES] }, updatedAt: { lt: new Date(now - 3_600_000) } },
          { status: 'SUCCEEDED', updatedAt: { lt: new Date(now - 7 * DAY) } },
          // Periódico que falhou (ex.: Proxmox fora do ar) roda de novo no minuto seguinte; 1 dia basta para investigar.
          { status: 'FAILED', type: { in: [...PERIODIC_JOB_TYPES] }, updatedAt: { lt: dayAgo } },
        ],
      },
    });
    if (sessions.count || jobs.count) ctx.logger.info({ sessions: sessions.count, jobs: jobs.count }, 'limpeza concluída');
  }
}
