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
  DATABASE_URL: z.url({ protocol: /^mysql$/, error: 'precisa ser mysql://usuario:senha@host:porta/banco' }),
  /** Tamanho do pool de conexões do adapter MariaDB (plano §8.2). */
  DB_POOL_LIMIT: z.coerce.number().int().min(1).max(50).default(5),

  // ── Sessão e CSRF (plano §9) ──
  /** Segredo do HMAC do token CSRF (Signed Double-Submit Cookie). Trocar o segredo invalida todos os tokens. */
  CSRF_SECRET: z.string().min(32, 'precisa ter pelo menos 32 caracteres'),
  CSRF_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  SESSION_IDLE_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** true quando servido por HTTPS: cookies com Secure e prefixo __Host- (plano §9.3). */
  COOKIE_SECURE: z.stringbool().default(false),

  // ── Proxmox (plano §3.4–3.5 e §10; gravadas por scripts/pve/bootstrap.sh) ──
  PVE_URL: z.url({ protocol: /^https$/ }),
  PVE_NODE: z.string().min(1),
  PVE_TOKEN_ID: z.string().regex(/^[^@\s]+@[^!\s]+![A-Za-z][\w.-]*$/, 'formato usuario@realm!token'),
  PVE_TOKEN_SECRET: z.uuid(),
  PVE_CA_FILE: z.string().min(1),
  /** O certificado do nó não tem o IP no SAN: valida pelo nome do nó (CLAUDE.md, A9). */
  PVE_TLS_SERVERNAME: z.string().optional(),
  PVE_POOL: z.string().default('vps-platform'),
  PVE_STORAGE: z.string().default('local-lvm'),
  PVE_BRIDGE: z.string().default('vmbr1'),
  /** VMIDs das VPS começam aqui (os templates ficam em 9000+). */
  PVE_VMID_START: z.coerce.number().int().min(100).default(2000),
  PVE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  VPS_NAMESERVERS: z.string().default('1.1.1.1 8.8.8.8'),

  // ── Capacidade e cobrança (plano §11.5 e §12) ──
  /** Teto de RAM somada de todas as VPS (o lab tem ~1,5 GB livres para elas). */
  CAPACITY_MAX_MEMORY_MB: z.coerce.number().int().min(128).default(1536),
  /** Teto de disco somado (o thin pool tem 16,8 GB, com ~4 GB dos templates). */
  CAPACITY_MAX_DISK_GB: z.coerce.number().int().min(1).default(12),
  MAX_VPS_PER_USER: z.coerce.number().int().min(1).default(2),
  /** Prazo para pagar a fatura de criação; depois ela é cancelada (job expire_pending). */
  INVOICE_DUE_HOURS: z.coerce.number().int().min(1).default(24),
  /** Latência artificial do gateway simulado (0 nos testes). */
  PAYMENT_LATENCY_MS: z.coerce.number().int().min(0).max(10_000).optional(),

  // ── Suporte (plano §13.1) ──
  SUPPORT_MAX_ACTIVE_PER_AGENT: z.coerce.number().int().min(1).max(50).default(3),

  // ── Worker de jobs (plano §11.2) ──
  /** false: o processo só atende HTTP (útil para depurar sem mexer no Proxmox). */
  WORKER_ENABLED: z.stringbool().default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
  /** Prefixo do `lockedBy` dos jobs; na subida, os jobs RUNNING com este prefixo voltam para a fila. */
  WORKER_ID: z
    .string()
    .regex(/^[\w.-]{1,40}$/)
    .optional(),
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  /** Depois do guest agent, espera a porta 22 abrir antes de marcar RUNNING (o servidor alcança a rede das VPS). */
  VPS_WAIT_SSH: z.stringbool().default(true),

  /** Chave AES-256-GCM (32 bytes em base64) que cifra as senhas no payload dos jobs (plano §10.6). */
  JOB_SECRET_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'precisa ser 32 bytes em base64 (openssl rand -base64 32)'),
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
