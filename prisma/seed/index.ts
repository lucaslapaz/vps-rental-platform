// Entrypoint do `prisma db seed` (configurado em prisma.config.ts). O prisma.config.ts já carregou o .env.<NODE_ENV>.
import 'reflect-metadata';
import { createPrismaClient } from '../../src/server/db/prisma.ts';
import { loadSeedEnv } from './env.ts';
import { runSeed } from './run.ts';

const env = loadSeedEnv();
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL não definida');

const db = createPrismaClient({ url, poolLimit: 2 });
try {
  console.log(`Seed (${env.NODE_ENV}) em ${new URL(url).pathname.slice(1)}`);
  await runSeed(db, env, (msg) => console.log(`  - ${msg}`));
  console.log('Seed concluído.');
} finally {
  await db.$disconnect();
}
