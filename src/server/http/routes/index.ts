import { Router } from 'express';
import type { DependencyContainer } from 'tsyringe';
import { HealthController } from '../../controllers/HealthController.ts';

/** Todas as rotas da API, montadas em /api. Os controllers vêm do container (plano §7). */
export function createApiRouter(di: DependencyContainer) {
  const router = Router();
  const health = di.resolve(HealthController);

  router.get('/health', health.show);

  return router;
}
