/**
 * MCP da Favo por stdio (plano §16.3, Fase 10): `npm run mcp`. Para usar no Claude Code, na raiz do projeto:
 *
 *   claude mcp add favo-pve -- npm run --silent mcp
 *
 * No stdio a saída padrão é só do protocolo: o log fica desligado e nada aqui usa console.log.
 */
import 'reflect-metadata';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { container } from 'tsyringe';
import { loadEnv } from '../../src/server/config/env.ts';
import { registerDependencies } from '../../src/server/container/register.ts';
import { TOKENS } from '../../src/server/container/tokens.ts';
import { createPrismaClient } from '../../src/server/db/prisma.ts';
import { ProxmoxClient } from '../../src/server/integrations/proxmox/ProxmoxClient.ts';
import type { VirtualizationProvider } from '../../src/server/integrations/virtualization/VirtualizationProvider.ts';
import { createLogger } from '../../src/server/utils/logger.ts';
import { PlatformInspector } from '../pve/inspect.ts';
import { createFavoMcpServer } from './favoMcp.ts';

const env = loadEnv();
const prisma = createPrismaClient({ url: env.DATABASE_URL, poolLimit: 2 });
// Sem o pino-pretty (NODE_ENV "production") e sem saída: o stdout é do protocolo MCP.
const logger = createLogger({ ...env, NODE_ENV: 'production', LOG_LEVEL: 'silent' });
const di = registerDependencies({ env, logger, prisma }, container.createChildContainer());
const inspector = new PlatformInspector(
  env,
  di.resolve<VirtualizationProvider>(TOKENS.VirtualizationProvider),
  di.resolve(ProxmoxClient),
  prisma,
);

const server = createFavoMcpServer(inspector);
await server.connect(new StdioServerTransport());

const shutdown = async () => {
  await server.close();
  await prisma.$disconnect();
  await di.resolve(ProxmoxClient).close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('close', () => void shutdown());
