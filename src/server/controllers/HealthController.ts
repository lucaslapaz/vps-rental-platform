import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import type { HealthResponse } from '../../shared/types/health.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import { HealthRepository } from '../repositories/HealthRepository.ts';
import type { Clock } from '../utils/clock.ts';

@injectable()
export class HealthController {
  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
    @inject(HealthRepository) private readonly health: HealthRepository,
  ) {}

  /** GET /api/health: 200 se tudo está ok, 503 se o banco não responde. O Proxmox entra na Fase 4. */
  show = async (_req: Request, res: Response<HealthResponse>) => {
    const database = (await this.health.ping()) ? 'ok' : 'down';
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      environment: this.env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      time: this.clock.now().toISOString(),
      checks: { database },
    });
  };
}
