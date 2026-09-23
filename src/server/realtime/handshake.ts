import type http from 'node:http';
import type { Env } from '../config/env.ts';
import { cookieNames } from '../http/cookies.ts';
import type { SessionService } from '../services/SessionService.ts';

/** Lê um cookie do header bruto (handshakes de WebSocket não passam pelo cookie-parser do Express). */
export function readCookie(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * WebSocket não passa por CORS: sem conferir o Origin, qualquer site poderia abrir um socket com os cookies da vítima
 * (Cross-Site WebSocket Hijacking). Aceita a origem pública do app ou a própria origem do host (mesma regra do
 * originCheck HTTP, CLAUDE.md N23). Sem Origin (cliente que não é navegador) também passa: o cookie ainda é exigido.
 */
export function isAllowedOrigin(env: Env, req: http.IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === env.APP_ORIGIN || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}

/** Usuário da sessão do cookie HttpOnly, ou null. */
export async function authenticateHandshake(env: Env, sessions: SessionService, req: http.IncomingMessage) {
  const token = readCookie(req.headers.cookie, cookieNames(env).session);
  if (!token) return null;
  const result = await sessions.authenticate(token).catch(() => null);
  return result?.user ?? null;
}
