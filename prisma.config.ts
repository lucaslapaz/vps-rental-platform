import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// O NODE_ENV vem do cross-env nos scripts do package.json e decide o banco (.env.<ambiente>, fora do git). Plano §8.2.
const nodeEnv = process.env.NODE_ENV ?? 'development';
const envFile = `.env.${nodeEnv}`;
if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // No Prisma 7 o seed não roda sozinho no migrate dev/reset: só com `prisma db seed` (CLAUDE.md, N4).
    seed: 'tsx --tsconfig tsconfig.server.json prisma/seed/index.ts',
  },
  datasource: {
    // `prisma generate` não precisa de banco; os comandos que precisam falham com mensagem clara se faltar a URL.
    url: process.env.DATABASE_URL ?? '',
    // Banco shadow pré-criado (o vps_app não tem CREATE DATABASE global). Só existe em desenvolvimento.
    ...(process.env.SHADOW_DATABASE_URL ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL } : {}),
  },
});
