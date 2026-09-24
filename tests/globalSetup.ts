import { loadSeedEnv } from '../prisma/seed/env.ts';
import { runSeed } from '../prisma/seed/run.ts';
import { loadEnv } from '../src/server/config/env.ts';
import { createPrismaClient } from '../src/server/db/prisma.ts';
import { resetTestData } from './helpers/resetTestData.ts';

/** Roda uma vez antes de todos os testes: limpa o que sobrou de execuções anteriores e garante o seed (idempotente). */
export default async function setup() {
  const env = loadEnv();
  if (env.NODE_ENV !== 'test' || !env.DATABASE_URL.includes('_test'))
    throw new Error('globalSetup: use NODE_ENV=test (banco vps_platform_test)');
  const db = createPrismaClient({ url: env.DATABASE_URL, poolLimit: 2 });
  try {
    await resetTestData(db, env.DATABASE_URL);
    await runSeed(db, loadSeedEnv());
  } finally {
    await db.$disconnect();
  }
}
