import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import type { ViteDevServer } from 'vite';
import { createApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { registerDependencies } from './container/register.ts';
import { errorHandler } from './http/middlewares/errorHandler.ts';
import { spaHandler } from './http/spa.ts';
import { createLogger } from './utils/logger.ts';

const env = loadEnv();
const logger = createLogger(env);
const di = registerDependencies({ env, logger });

const app = createApp(di);
const httpServer = http.createServer(app);
let vite: ViteDevServer | undefined;

if (env.NODE_ENV === 'development') {
  // Import dinâmico: em produção o Vite nem é carregado (fica em devDependencies).
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true, hmr: { server: httpServer } }, // HMR na mesma porta do app
    appType: 'custom', // o Express serve o HTML (e, na Fase 3, os cookies de CSRF)
  });
  const devServer = vite;
  app.use(devServer.middlewares);
  app.get(
    '/{*splat}',
    spaHandler(async (req) => devServer.transformIndexHtml(req.originalUrl, await readFile('src/client/index.html', 'utf8'))),
  );
} else {
  // Arquivos com hash do Vite: cache longo. O resto (favicon…) com cache curto. index: false → o HTML só sai pelo spaHandler.
  app.use('/assets', express.static('dist/client/assets', { index: false, immutable: true, maxAge: '1y' }));
  app.use(express.static('dist/client', { index: false, maxAge: '1h' }));
  const html = await readFile('dist/client/index.html', 'utf8');
  app.get(
    '/{*splat}',
    spaHandler(async () => html),
  );
}
app.use(errorHandler);

httpServer.listen(env.PORT, env.HOST, () => {
  logger.info(`Favo rodando em ${env.APP_ORIGIN} (${env.NODE_ENV})`);
});

// Encerramento gracioso (a lista cresce nas próximas fases: worker de jobs, Socket.IO, Prisma).
let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info(`${signal} recebido, encerrando…`);
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  await vite?.close();
  httpServer.closeAllConnections();
  httpServer.close(() => process.exit(0));
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
