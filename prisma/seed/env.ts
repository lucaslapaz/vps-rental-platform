import { z } from 'zod';

/** Variáveis do seed. Em produção, o admin inicial é obrigatório e vem do ambiente (nunca de um valor fixo). */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SEED_DEFAULT_PASSWORD: z.string().min(10).optional(),
    SEED_ADMIN_EMAIL: z.email().optional(),
    SEED_ADMIN_PASSWORD: z.string().optional(),
    IP_POOL_START: z.ipv4().optional(),
    IP_POOL_END: z.ipv4().optional(),
    IP_POOL_PREFIX: z.coerce.number().int().min(8).max(30).default(24),
    IP_POOL_GATEWAY: z.ipv4().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production') {
      if (!v.SEED_ADMIN_EMAIL) ctx.addIssue({ code: 'custom', path: ['SEED_ADMIN_EMAIL'], message: 'obrigatório em produção' });
      if (!v.SEED_ADMIN_PASSWORD || v.SEED_ADMIN_PASSWORD.length < 12) {
        ctx.addIssue({ code: 'custom', path: ['SEED_ADMIN_PASSWORD'], message: 'obrigatório em produção, com pelo menos 12 caracteres' });
      }
    } else if (!v.SEED_DEFAULT_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['SEED_DEFAULT_PASSWORD'],
        message: 'obrigatório em dev/test (senha dos usuários de demonstração)',
      });
    }
  });

export type SeedEnv = z.infer<typeof schema>;

export function loadSeedEnv(source: NodeJS.ProcessEnv = process.env): SeedEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Seed: variáveis de ambiente inválidas:\n${problems}`);
  }
  return parsed.data;
}

/** Faixa de IPs das VPS por ambiente (plano §3.3). O .229 fica fora do pool: é o IP dos testes manuais/de aceite. */
export function ipPoolFor(env: SeedEnv) {
  const defaults =
    env.NODE_ENV === 'test'
      ? { start: '10.99.0.10', end: '10.99.0.19', gateway: '10.99.0.1' } // faixa fictícia
      : { start: '192.168.56.200', end: '192.168.56.228', gateway: '192.168.56.10' };
  return {
    start: env.IP_POOL_START ?? defaults.start,
    end: env.IP_POOL_END ?? defaults.end,
    gateway: env.IP_POOL_GATEWAY ?? defaults.gateway,
    prefix: env.IP_POOL_PREFIX,
  };
}
