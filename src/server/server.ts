import { readFile } from 'node:fs/promises';
import http from 'node:http';
import express from 'express';
import type { ViteDevServer } from 'vite';
import { createApp } from './app.ts';
import type { Env } from './config/env.ts';
import { registerDependencies } from './container/register.ts';
import { createPrismaClient } from './db/prisma.ts';
import { errorHandler } from './http/middlewares/errorHandler.ts';
import { spaHandler } from './http/spa.ts';
import type { VirtualizationProvider } from './integrations/virtualization/VirtualizationProvider.ts';
import { JobWorker } from './jobs/JobWorker.ts';
import { attachConsoleProxy } from './realtime/consoleProxy.ts';
import { attachSocketIo } from './realtime/socket.ts';
import { createLogger } from './utils/logger.ts';

export interface StartOptions {
  env: Env;
  /** Provider alternativo (o E2E usa o falso, sem Proxmox). Sem ele, é o Proxmox de verdade. */
  virtualization?: VirtualizationProvider;
  /** true: Vite em modo middleware (HMR); false: arquivos do `dist/client` (produção e E2E). */
  vite: boolean;
}

/**
 * Monta o servidor único (plano §6): API + Socket.IO + proxy do console + SPA no mesmo http.Server, e o worker de
 * jobs. Usado pelo `main.ts` (dev/produção) e pelo servidor do E2E. Devolve o `stop()` do encerramento gracioso.
 */
export async function startServer({ env, virtualization, vite: useVite }: StartOptions) {
  const logger = createLogger(env);
  // Um único PrismaClient (e um único pool) por processo.
  const prisma = createPrismaClient({ url: env.DATABASE_URL, poolLimit: env.DB_POOL_LIMIT });
  const di = registerDependencies({ env, logger, prisma, ...(virtualization ? { virtualization } : {}) });

  const app = createApp(di);
  const httpServer = http.createServer(app);
  // Socket.IO no mesmo servidor, antes do Vite: os dois tratam "upgrade" e nenhum destrói o do outro (CLAUDE.md N7).
  const io = attachSocketIo(httpServer, di);
  const consoleProxy = attachConsoleProxy(httpServer, di);
  let vite: ViteDevServer | undefined;

  if (useVite) {
    // Import dinâmico: em produção o Vite nem é carregado (fica em devDependencies).
    const { createServer } = await import('vite');
    vite = await createServer({
      server: { middlewareMode: true, hmr: { server: httpServer } }, // HMR na mesma porta do app
      appType: 'custom', // o Express serve o HTML (e os cookies de CSRF)
    });
    const devServer = vite;
    app.use(devServer.middlewares);
    app.get(
      '/{*splat}',
      spaHandler(di, async (req) => devServer.transformIndexHtml(req.originalUrl, await readFile('src/client/index.html', 'utf8'))),
    );
  } else {
    // Arquivos com hash do Vite: cache longo. O resto (favicon…) com cache curto. index: false → o HTML só sai pelo spaHandler.
    app.use('/assets', express.static('dist/client/assets', { index: false, immutable: true, maxAge: '1y' }));
    app.use(express.static('dist/client', { index: false, maxAge: '1h' }));
    const html = await readFile('dist/client/index.html', 'utf8');
    app.get(
      '/{*splat}',
      spaHandler(di, async () => html),
    );
  }
  app.use(errorHandler);

  const worker = env.WORKER_ENABLED ? di.resolve(JobWorker) : undefined;
  await new Promise<void>((resolve) => httpServer.listen(env.PORT, env.HOST, resolve));
  logger.info(`Favo rodando em ${env.APP_ORIGIN} (${env.NODE_ENV})`);
  worker?.start().catch((err) => logger.error({ err }, 'não foi possível iniciar o worker de jobs'));

  // Encerramento gracioso (plano §8.2): worker para de pegar jobs (os em andamento voltam para a fila e retomam do
  // checkpoint na próxima subida) → sockets → HTTP → Vite → pool do banco.
  let closing: Promise<void> | undefined;
  const stop = () => {
    closing ??= (async () => {
      await worker?.stop();
      io.disconnectSockets(true);
      consoleProxy.close();
      const serverClosed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
      httpServer.closeAllConnections();
      await serverClosed;
      await vite?.close();
      await prisma.$disconnect();
    })();
    return closing;
  };
  return { stop, logger, di };
}

/** Encerra com SIGINT/SIGTERM, com saída forçada em 10 s se algo travar (ex.: banco fora do ar, CLAUDE.md N19). */
export function handleSignals(stop: () => Promise<void>, logger: { info: (msg: string) => void }) {
  const onSignal = (signal: string) => {
    logger.info(`${signal} recebido, encerrando…`);
    const forceExit = setTimeout(() => process.exit(1), 10_000);
    forceExit.unref();
    void stop().then(() => process.exit(0));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
}
