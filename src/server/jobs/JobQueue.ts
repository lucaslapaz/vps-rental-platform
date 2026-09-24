import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { InputJsonValue } from '../generated/prisma/internal/prismaNamespace.ts';
import type { Clock } from '../utils/clock.ts';

export type JobType =
  | 'provision_vps'
  | 'vps_action'
  | 'resize_vps'
  | 'delete_vps'
  | 'reconcile'
  | 'expire_pending'
  | 'cleanup_sessions'
  | 'billing_cycle'
  | 'suspend_vps';

export interface ClaimedJob {
  id: number;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

type Tx = Parameters<Parameters<Database['$transaction']>[0]>[0];

/** Locks mais antigos que isto voltam para a fila: o processo pode ter caído no meio do job (plano §11.2). */
const ORPHAN_LOCK_MS = 10 * 60 * 1000;

/**
 * Fila de jobs no próprio MySQL (plano §11.2), sem Redis: persistente, sobrevive a restart e basta para a escala do
 * projeto. Os jobs são reivindicados com SELECT … FOR UPDATE SKIP LOCKED, então dois workers nunca pegam o mesmo.
 */
@injectable()
export class JobQueue {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /** Enfileira. Com `tx`, entra na MESMA transação da mudança de estado (outbox: nunca "VPS em transição sem job"). */
  enqueue(type: JobType, payload: InputJsonValue, options: { tx?: Tx; runAt?: Date; maxAttempts?: number } = {}) {
    const client = options.tx ?? this.db;
    return client.job.create({
      data: {
        type,
        payload,
        runAt: options.runAt ?? this.clock.now(),
        ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
      },
    });
  }

  /** Reivindica até `limit` jobs prontos, de forma atômica. */
  async claim(workerId: string, limit: number): Promise<ClaimedJob[]> {
    const now = this.clock.now();
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM jobs WHERE status = 'QUEUED' AND runAt <= ${now} ORDER BY runAt, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return [];
      const ids = rows.map((r) => Number(r.id));
      await tx.job.updateMany({
        where: { id: { in: ids } },
        data: { status: 'RUNNING', lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
      });
      const jobs = await tx.job.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
      return jobs.map((j) => ({
        id: j.id,
        type: j.type as JobType,
        payload: (j.payload ?? {}) as Record<string, unknown>,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
      }));
    });
  }

  /** Grava o progresso no payload (idempotência: numa nova tentativa, o handler retoma daqui, plano §11.2). */
  // updateMany (e não update): se o job sumiu da tabela no meio da execução (limpeza, intervenção manual, o reset do banco
  // de teste), não há o que gravar, e um erro aqui não pode derrubar o processo.

  checkpoint(id: number, payload: InputJsonValue) {
    return this.db.job.updateMany({ where: { id }, data: { payload } });
  }

  complete(id: number, payload?: InputJsonValue) {
    return this.db.job.updateMany({
      where: { id },
      data: { status: 'SUCCEEDED', lockedAt: null, lockedBy: null, lastError: null, ...(payload === undefined ? {} : { payload }) },
    });
  }

  /** Falha: tenta de novo com backoff exponencial (2^tentativas s) até maxAttempts; depois FAILED. */
  async fail(job: ClaimedJob, error: unknown, options: { permanent?: boolean; payload?: InputJsonValue } = {}) {
    const message = error instanceof Error ? error.message : String(error);
    const final = options.permanent || job.attempts >= job.maxAttempts;
    await this.db.job.updateMany({
      where: { id: job.id },
      data: {
        status: final ? 'FAILED' : 'QUEUED',
        lockedAt: null,
        lockedBy: null,
        lastError: message.slice(0, 5000),
        ...(final ? {} : { runAt: new Date(this.clock.now().getTime() + 2 ** job.attempts * 1000) }),
        ...(options.payload === undefined ? {} : { payload: options.payload }),
      },
    });
    return { final };
  }

  /** Jobs RUNNING com lock velho (processo caiu no meio) voltam para QUEUED. */
  async recoverOrphans() {
    const r = await this.db.job.updateMany({
      where: { status: 'RUNNING', lockedAt: { lt: new Date(this.clock.now().getTime() - ORPHAN_LOCK_MS) } },
      data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
    });
    return r.count;
  }

  /**
   * Na subida do processo, os jobs deste mesmo worker que ficaram RUNNING (o processo anterior morreu) voltam na hora,
   * sem esperar os 10 minutos do lock órfão.
   */
  async releaseStale(workerPrefix: string) {
    const r = await this.db.job.updateMany({
      where: { status: 'RUNNING', lockedBy: { startsWith: workerPrefix } },
      data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
    });
    return r.count;
  }

  /** Há um job pendente deste tipo? (evita empilhar jobs periódicos, como o reconcile) */
  async hasPending(type: JobType) {
    return (await this.db.job.count({ where: { type, status: { in: ['QUEUED', 'RUNNING'] } } })) > 0;
  }
}
