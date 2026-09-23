import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import type { HealthResponse } from '../../shared/types/health.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { HealthRepository } from '../repositories/HealthRepository.ts';
import type { Clock } from '../utils/clock.ts';

const withTimeout = (p: Promise<boolean>, ms: number) =>
  Promise.race([p.catch(() => false), new Promise<boolean>((r) => setTimeout(() => r(false), ms).unref())]);

@injectable()
export class HealthController {
  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(HealthRepository) private readonly health: HealthRepository,
    @inject(TOKENS.VirtualizationProvider) private readonly virtualization: VirtualizationProvider,
  ) {}

  /**
   * GET /api/health (plano §15): estado do app, do banco e do Proxmox. 503 só se o banco cair (sem ele nada funciona);
   * com o Proxmox fora, o app continua de pé (login, faturas, suporte) e o status fica `degraded`.
   */
  show = async (_req: Request, res: Response<HealthResponse>) => {
    const [db, pve] = await Promise.all([this.health.ping(), withTimeout(this.virtualization.ping(), 3000)]);
    const database = db ? 'ok' : 'down';
    const proxmox = pve ? 'ok' : 'down';
    res.status(db ? 200 : 503).json({
      status: db && pve ? 'ok' : 'degraded',
      environment: this.env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      time: this.clock.now().toISOString(),
      checks: { database, proxmox },
    });
  };
}
