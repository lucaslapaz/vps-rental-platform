import os from 'node:os';
import { inject, injectable } from 'tsyringe';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { InputJsonValue } from '../generated/prisma/internal/prismaNamespace.ts';
import type { Logger } from '../utils/logger.ts';
import { DeleteVpsHandler } from './handlers/DeleteVpsHandler.ts';
import { CleanupHandler, ExpirePendingHandler } from './handlers/MaintenanceHandlers.ts';
import { ProvisionVpsHandler } from './handlers/ProvisionVpsHandler.ts';
import { ReconcileHandler } from './handlers/ReconcileHandler.ts';
import { ResizeVpsHandler } from './handlers/ResizeVpsHandler.ts';
import { errorMessage, type JobContext, type JobHandler, PermanentJobError } from './handlers/types.ts';
import { VpsActionHandler } from './handlers/VpsActionHandler.ts';
import { type ClaimedJob, JobQueue, type JobType } from './JobQueue.ts';

/** Jobs periódicos: tipo → intervalo. Só é enfileirado se não houver outro do mesmo tipo pendente. */
const MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000;

/** Tira as chaves `undefined` (o JSON do payload não as representa). */
const clean = (payload: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)) as InputJsonValue;

/**
 * Worker no próprio processo (plano §11.2): a cada WORKER_POLL_MS reivindica jobs (até WORKER_CONCURRENCY em paralelo)
 * e agenda os periódicos (reconcile a cada 60 s; expirar faturas e limpeza a cada 15 min).
 */
@injectable()
export class JobWorker {
  readonly workerId: string;
  private readonly handlers: Record<JobType, JobHandler>;
  private readonly inflight = new Set<Promise<void>>();
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private stopped = true;
  private lastScheduled = new Map<JobType, number>();

  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Logger) private readonly logger: Logger,
    @inject(JobQueue) private readonly queue: JobQueue,
    @inject(ProvisionVpsHandler) provision: ProvisionVpsHandler,
    @inject(VpsActionHandler) action: VpsActionHandler,
    @inject(ResizeVpsHandler) resize: ResizeVpsHandler,
    @inject(DeleteVpsHandler) remove: DeleteVpsHandler,
    @inject(ReconcileHandler) reconcile: ReconcileHandler,
    @inject(ExpirePendingHandler) expire: ExpirePendingHandler,
    @inject(CleanupHandler) cleanup: CleanupHandler,
  ) {
    this.workerId = `${env.WORKER_ID ?? os.hostname()}#${process.pid}`;
    this.handlers = {
      provision_vps: provision,
      vps_action: action,
      resize_vps: resize,
      delete_vps: remove,
      reconcile,
      expire_pending: expire,
      cleanup_sessions: cleanup,
    };
  }

  private get prefix() {
    return `${this.env.WORKER_ID ?? os.hostname()}#`;
  }

  async start() {
    // O processo anterior pode ter morrido no meio de um job: os jobs dele voltam para a fila agora (e retomam do
    // checkpoint), sem esperar os 10 min do lock órfão.
    const released = await this.queue.releaseStale(this.prefix);
    if (released) this.logger.warn({ released }, 'jobs interrompidos voltaram para a fila');
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.env.WORKER_POLL_MS);
    this.logger.info({ workerId: this.workerId, concurrency: this.env.WORKER_CONCURRENCY }, 'worker de jobs iniciado');
  }

  /** Para de reivindicar, espera os jobs em andamento por até `graceMs` e devolve à fila os que não terminaram. */
  async stop(graceMs = 5000) {
    this.stopped = true;
    clearInterval(this.timer);
    if (this.inflight.size) {
      await Promise.race([Promise.allSettled([...this.inflight]), new Promise((r) => setTimeout(r, graceMs))]);
    }
    if (this.inflight.size) {
      const released = await this.queue.releaseStale(this.workerId);
      this.logger.warn({ released }, 'jobs em andamento devolvidos à fila (retomam na próxima subida)');
    }
  }

  private async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      await this.schedulePeriodic();
      const free = this.env.WORKER_CONCURRENCY - this.inflight.size;
      if (free <= 0) return;
      for (const job of await this.queue.claim(this.workerId, free)) {
        const running = this.execute(job).finally(() => this.inflight.delete(running));
        this.inflight.add(running);
      }
    } catch (err) {
      this.logger.error({ err }, 'erro no ciclo do worker');
    } finally {
      this.ticking = false;
    }
  }

  private async schedulePeriodic() {
    const now = Date.now();
    const due: [JobType, number][] = [
      ['reconcile', this.env.RECONCILE_INTERVAL_SECONDS * 1000],
      ['expire_pending', MAINTENANCE_INTERVAL_MS],
      ['cleanup_sessions', MAINTENANCE_INTERVAL_MS],
    ];
    for (const [type, interval] of due) {
      if (now - (this.lastScheduled.get(type) ?? 0) < interval) continue;
      this.lastScheduled.set(type, now);
      if (!(await this.queue.hasPending(type))) await this.queue.enqueue(type, {}, { maxAttempts: 1 });
    }
  }

  /** Executa um job já reivindicado. Público para os testes processarem a fila sem timers (ver `drain`). */
  async execute(job: ClaimedJob) {
    const handler = this.handlers[job.type];
    const logger = this.logger.child({ jobId: job.id, type: job.type, attempt: job.attempts });
    const ctx: JobContext = {
      job,
      logger,
      save: async (patch) => {
        job.payload = { ...job.payload, ...patch };
        await this.queue.checkpoint(job.id, clean(job.payload));
      },
    };
    try {
      if (!handler) throw new PermanentJobError(`tipo de job desconhecido: ${job.type}`);
      await handler.run(ctx);
      await this.queue.complete(job.id, clean(job.payload));
      logger.debug('job concluído');
    } catch (err) {
      const final = err instanceof PermanentJobError || job.attempts >= job.maxAttempts;
      logger[final ? 'error' : 'warn']({ err: errorMessage(err) }, final ? 'job falhou de vez' : 'job falhou; nova tentativa agendada');
      if (final && handler?.onFinalFailure) {
        await handler.onFinalFailure(ctx, err).catch((e) => logger.error({ err: errorMessage(e) }, 'erro ao desfazer o job'));
      }
      await this.queue.fail(job, err, { permanent: final, payload: clean(job.payload) });
    }
  }

  /** Testes: processa tudo o que estiver pronto na fila, em série, até esvaziar (ou `maxJobs`). */
  async drain(maxJobs = 50) {
    let processed = 0;
    while (processed < maxJobs) {
      const [job] = await this.queue.claim(this.workerId, 1);
      if (!job) break;
      await this.execute(job);
      processed++;
    }
    return processed;
  }
}
