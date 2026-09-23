import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import type { HealthResponse } from '../../shared/types/health.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Clock } from '../utils/clock.ts';

@injectable()
export class HealthController {
  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /** GET /api/health. Banco e Proxmox entram aqui nas fases 2 e 4. */
  show = (_req: Request, res: Response<HealthResponse>) => {
    res.json({
      status: 'ok',
      environment: this.env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      time: this.clock.now().toISOString(),
    });
  };
}
