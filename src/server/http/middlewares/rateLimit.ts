import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Env } from '../../config/env.ts';
import { AppError } from '../../utils/errors.ts';

interface LimitOptions {
  windowMinutes: number;
  limit: number;
  /** Chave extra além do IP (ex.: e-mail do login). */
  by?: 'ip' | 'email';
}

/**
 * Limite de tentativas (plano §9.3). Fica desligado em NODE_ENV=test para os testes de integração poderem logar várias
 * vezes; os limites de produção valem em dev e prod.
 */
export function limiter(env: Env, { windowMinutes, limit, by = 'ip' }: LimitOptions) {
  return rateLimit({
    windowMs: windowMinutes * 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: (req) => {
      if (by === 'email') {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return `email:${email}`;
      }
      return `ip:${ipKeyGenerator(req.ip ?? '')}`;
    },
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Muitas tentativas. Aguarde alguns minutos.')),
  });
}
