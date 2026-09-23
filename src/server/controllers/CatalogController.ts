import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import { CatalogService } from '../services/CatalogService.ts';

@injectable()
export class CatalogController {
  constructor(
    @inject(CatalogService) private readonly catalog: CatalogService,
    @inject(TOKENS.Env) private readonly env: Env,
  ) {}

  /** GET /api/plans (público) */
  plans = async (_req: Request, res: Response) => {
    // A "localização" é o nó do laboratório (plano §14.5: mostra o conceito de região sem inventar infraestrutura).
    res.json({ plans: await this.catalog.plans(), location: { node: this.env.PVE_NODE } });
  };

  /** GET /api/os-templates (público) */
  osTemplates = async (_req: Request, res: Response) => {
    res.json({ osTemplates: await this.catalog.osTemplates() });
  };
}
