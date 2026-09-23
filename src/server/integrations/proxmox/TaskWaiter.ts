import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import { ProxmoxClient } from './ProxmoxClient.ts';

const taskStatusSchema = z.object({ status: z.string(), exitstatus: z.string().optional(), type: z.string().optional() });
const taskLogSchema = z.array(z.object({ n: z.number(), t: z.string() }));

/** Task do Proxmox que terminou com erro. `log` traz as últimas linhas, que vão para o VpsEvent (plano §10.3). */
export class ProxmoxTaskError extends Error {
  constructor(
    readonly upid: string,
    readonly exitstatus: string,
    readonly log: string[],
  ) {
    super(`task ${upid} falhou: ${exitstatus}${log.length ? ` — ${log.slice(-3).join(' | ')}` : ''}`);
    this.name = 'ProxmoxTaskError';
  }
}

export const isUpid = (v: unknown): v is string => typeof v === 'string' && v.startsWith('UPID:');

/**
 * Espera uma task assíncrona (UPID) terminar, consultando /tasks/{upid}/status com backoff 1 s → 2 s → 3 s (teto).
 * `exitstatus === "OK"` é sucesso; qualquer outro valor é falha (plano §10.3). Operações síncronas (sem UPID) passam direto.
 */
@injectable()
export class TaskWaiter {
  constructor(
    @inject(ProxmoxClient) private readonly client: ProxmoxClient,
    @inject(TOKENS.Env) private readonly env: Env,
  ) {}

  async wait(upid: unknown, { timeoutMs = 300_000 } = {}): Promise<void> {
    if (!isUpid(upid)) return;
    const path = `/nodes/${this.env.PVE_NODE}/tasks/${encodeURIComponent(upid)}`;
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      const s = await this.client.get(`${path}/status`, taskStatusSchema);
      if (s.status === 'stopped') {
        if (s.exitstatus === 'OK') return;
        const log = await this.client.get(`${path}/log`, taskLogSchema, { start: 0, limit: 500 }).catch(() => []);
        throw new ProxmoxTaskError(upid, s.exitstatus ?? 'desconhecido', log.map((l) => l.t).filter(Boolean));
      }
      if (Date.now() - started > timeoutMs) throw new ProxmoxTaskError(upid, 'tempo esgotado esperando a task', []);
      await new Promise((r) => setTimeout(r, Math.min(attempt, 3) * 1000));
    }
  }
}
