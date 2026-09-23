import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const nodeEnv = z.enum(NODE_ENVS).catch('development').parse(process.env.NODE_ENV);

// Carrega .env.<ambiente> (fora do git). Variáveis já definidas no processo têm prioridade.
const envFile = `.env.${nodeEnv}`;
if (existsSync(envFile)) loadDotenv({ path: envFile, quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(NODE_ENVS),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('localhost'),
  /** Origem pública do app (usada no originCheck e no CSP). */
  APP_ORIGIN: z.url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema> & { APP_ORIGIN: string };

/** Lê e valida as variáveis de ambiente. Falha no boot com uma mensagem clara se algo estiver faltando ou inválido. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse({ ...source, NODE_ENV: nodeEnv });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas (${envFile}):\n${problems}`);
  }
  const env = parsed.data;
  return { ...env, APP_ORIGIN: env.APP_ORIGIN ?? `http://${env.HOST}:${env.PORT}` };
}
