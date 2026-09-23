import { container } from 'tsyringe';
import { createApp } from '../../src/server/app.ts';
import { type Env, loadEnv } from '../../src/server/config/env.ts';
import { registerDependencies } from '../../src/server/container/register.ts';
import { createPrismaClient, type Database } from '../../src/server/db/prisma.ts';
import type { Clock } from '../../src/server/utils/clock.ts';
import { createLogger } from '../../src/server/utils/logger.ts';

let sharedPrisma: Database | undefined;

/** PrismaClient do banco de TESTE (vps_platform_test), compartilhado pelos testes do mesmo arquivo. */
export function testPrisma() {
  if (!sharedPrisma) {
    const env = loadEnv();
    if (env.NODE_ENV !== 'test' || !env.DATABASE_URL.includes('_test')) {
      throw new Error('Os testes só podem usar o banco de teste (NODE_ENV=test e DATABASE_URL de vps_platform_test)');
    }
    sharedPrisma = createPrismaClient({ url: env.DATABASE_URL, poolLimit: 3 });
  }
  return sharedPrisma;
}

export async function closeTestPrisma() {
  await sharedPrisma?.$disconnect();
  sharedPrisma = undefined;
}

/** App Express isolado para testes: container filho, então cada teste pode trocar dependências sem vazar estado. */
export function createTestApp(overrides: { env?: Partial<Env>; clock?: Clock; prisma?: Database } = {}) {
  const env = { ...loadEnv(), ...overrides.env };
  const di = registerDependencies(
    { env, logger: createLogger(env), prisma: overrides.prisma ?? testPrisma(), ...(overrides.clock ? { clock: overrides.clock } : {}) },
    container.createChildContainer(),
  );
  return { app: createApp(di), di, env };
}
