/**
 * Antes e depois do E2E: limpa os dados transitórios do banco de teste (VPS, jobs, conversas, usuários gerados) e
 * garante o seed. O E2E usa um provider falso próprio; sem a limpeza, as VPS dele sobrariam para o `npm test`, cujo
 * reconcile as marcaria como ERROR segurando IPs do pool (CLAUDE.md N36).
 */
process.env.NODE_ENV = 'test'; // antes de importar o env.ts, que lê o NODE_ENV na importação

export default async function globalSetup() {
  const { loadEnv } = await import('../src/server/config/env.ts');
  const { createPrismaClient } = await import('../src/server/db/prisma.ts');
  const { resetTestData } = await import('../tests/helpers/resetTestData.ts');
  const { runSeed } = await import('../prisma/seed/run.ts');
  const { loadSeedEnv } = await import('../prisma/seed/env.ts');
  const env = loadEnv();
  if (env.NODE_ENV !== 'test' || !env.DATABASE_URL.includes('_test')) throw new Error('E2E: use o banco vps_platform_test');
  const db = createPrismaClient({ url: env.DATABASE_URL, poolLimit: 2 });
  try {
    await resetTestData(db, env.DATABASE_URL);
    await runSeed(db, loadSeedEnv());
  } finally {
    await db.$disconnect();
  }
  // O teardown (retorno do globalSetup) limpa de novo no fim.
  return async () => {
    const after = createPrismaClient({ url: env.DATABASE_URL, poolLimit: 2 });
    try {
      await resetTestData(after, env.DATABASE_URL);
    } finally {
      await after.$disconnect();
    }
  };
}
