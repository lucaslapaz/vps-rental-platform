import type { Logger } from '../../utils/logger.ts';
import type { ClaimedJob } from '../JobQueue.ts';

export interface JobContext {
  job: ClaimedJob;
  logger: Logger;
  /** Mescla no payload e grava na hora (checkpoint): numa nova tentativa, o handler retoma daqui. */
  save(patch: Record<string, unknown>): Promise<void>;
}

export interface JobHandler {
  run(ctx: JobContext): Promise<void>;
  /** Chamado uma vez quando o job falha de vez (erro permanente ou tentativas esgotadas), para desfazer/sinalizar. */
  onFinalFailure?(ctx: JobContext, error: unknown): Promise<void>;
}

/** Erro que não adianta tentar de novo (dados inconsistentes, VM de outra pessoa…): o job falha na hora. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export type { VpsErrorCode } from '../../../shared/constants/vps.ts';

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
