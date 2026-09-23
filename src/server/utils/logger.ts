import { pino } from 'pino';
import type { Env } from '../config/env.ts';

/** Campos que nunca podem aparecer nos logs (plano §9.3). */
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.card*',
];

export function createLogger(env: Env) {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACT, censor: '[oculto]' },
    // pino-pretty só em desenvolvimento (é devDependency).
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
