import type { Request, Response } from 'express';
import type { Env } from '../config/env.ts';
import type { CsrfService } from '../services/CsrfService.ts';
import { randomToken } from '../utils/crypto.ts';
import { cookieNames, setCsrfCookie, setPreSessionCookie } from './cookies.ts';

/**
 * Garante um cookie `csrf` válido para o binding atual (plano §9.6, passo 1). Visitante sem sessão nem pré-sessão
 * ganha um `psid` novo. Usado ao servir o HTML da SPA e em GET /api/auth/csrf (`force` reemite mesmo se válido).
 */
export function ensureCsrfCookie(req: Request, res: Response, env: Env, csrf: CsrfService, { force = false } = {}) {
  let binding = csrf.bindingFor(req);
  if (!binding) {
    const psid = randomToken(24);
    setPreSessionCookie(res, env, psid);
    binding = csrf.bindingForPreSession(psid);
  } else if (!force && csrf.verify(req.cookies?.[cookieNames(env).csrf], binding)) {
    return;
  }
  setCsrfCookie(res, env, csrf.issue(binding));
}

/** Depois do login/cadastro: CSRF novo, amarrado à sessão nova; a pré-sessão deixa de existir. */
export function rotateCsrfForSession(res: Response, env: Env, csrf: CsrfService, sessionToken: string) {
  res.clearCookie(cookieNames(env).preSession, { path: '/', sameSite: 'strict', secure: env.COOKIE_SECURE, httpOnly: true });
  setCsrfCookie(res, env, csrf.issue(csrf.bindingForSessionToken(sessionToken)));
}

/** Depois do logout: pré-sessão e CSRF novos (os tokens antigos morrem). */
export function rotateCsrfForVisitor(res: Response, env: Env, csrf: CsrfService) {
  const psid = randomToken(24);
  setPreSessionCookie(res, env, psid);
  setCsrfCookie(res, env, csrf.issue(csrf.bindingForPreSession(psid)));
}
