import cookieParser from 'cookie-parser';
import express from 'express';
import { pinoHttp } from 'pino-http';
import type { DependencyContainer } from 'tsyringe';
import type { Env } from './config/env.ts';
import { TOKENS } from './container/tokens.ts';
import { apiNotFound, errorHandler } from './http/middlewares/errorHandler.ts';
import { createApiRouter } from './http/routes/index.ts';
import { securityHeaders } from './http/security.ts';
import type { Logger } from './utils/logger.ts';

/**
 * Monta o Express com os middlewares globais e a API. O frontend (Vite em dev, estáticos em produção) e o fallback
 * da SPA são acoplados depois, no main.ts, sempre DEPOIS de /api (plano §6).
 */
export function createApp(di: DependencyContainer) {
  const env = di.resolve<Env>(TOKENS.Env);
  const logger = di.resolve<Logger>(TOKENS.Logger);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(securityHeaders(env));
  app.use(
    pinoHttp({
      logger,
      // Assets do Vite e do build só poluiriam o log.
      autoLogging: { ignore: (req) => !req.url?.startsWith('/api') },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', createApiRouter(di));
  app.use('/api', apiNotFound);
  app.use('/api', errorHandler);

  return app;
}
