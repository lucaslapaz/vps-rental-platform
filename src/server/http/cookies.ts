import type { CookieOptions, Response } from 'express';
import type { Env } from '../config/env.ts';

/**
 * Cookies da autenticação (plano §9.3):
 * - `sid`  (sessão, HttpOnly): o JS nunca vê.
 * - `psid` (pré-sessão do visitante, HttpOnly): vincula o CSRF antes do login (login CSRF).
 * - `csrf` (NÃO HttpOnly): o JS lê e devolve no header X-CSRF-Token.
 * Com HTTPS (COOKIE_SECURE=true) viram `__Host-*` com Secure.
 */
export function cookieNames(env: Env) {
  const prefix = env.COOKIE_SECURE ? '__Host-' : '';
  return { session: `${prefix}sid`, preSession: `${prefix}psid`, csrf: `${prefix}csrf` } as const;
}

function base(env: Env): CookieOptions {
  return { path: '/', sameSite: 'strict', secure: env.COOKIE_SECURE };
}

export function setSessionCookie(res: Response, env: Env, token: string, expiresAt: Date) {
  res.cookie(cookieNames(env).session, token, { ...base(env), httpOnly: true, expires: expiresAt });
}

export function clearSessionCookie(res: Response, env: Env) {
  res.clearCookie(cookieNames(env).session, { ...base(env), httpOnly: true });
}

export function setPreSessionCookie(res: Response, env: Env, id: string) {
  // Cookie de sessão do navegador (sem expires): some ao fechar o navegador.
  res.cookie(cookieNames(env).preSession, id, { ...base(env), httpOnly: true });
}

export function setCsrfCookie(res: Response, env: Env, token: string) {
  res.cookie(cookieNames(env).csrf, token, { ...base(env), httpOnly: false });
}
