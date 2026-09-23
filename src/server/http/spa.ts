import type { Request, RequestHandler } from 'express';
import type { DependencyContainer } from 'tsyringe';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import { CsrfService } from '../services/CsrfService.ts';
import { ensureCsrfCookie } from './csrfCookies.ts';

/**
 * Fallback da SPA: entrega o index.html para qualquer rota que não seja da API nem um arquivo estático, e junto os
 * cookies `psid`/`csrf` (plano §9.6, passo 1): como o HTML é estático, é aqui que o token chega ao navegador.
 * O HTML sempre passa por aqui (em produção o express.static usa `index: false`). `no-store`: nunca fica em cache.
 */
export function spaHandler(di: DependencyContainer, getHtml: (req: Request) => Promise<string>): RequestHandler {
  const env = di.resolve<Env>(TOKENS.Env);
  const csrf = di.resolve(CsrfService);
  return async (req, res) => {
    const html = await getHtml(req);
    ensureCsrfCookie(req, res, env, csrf);
    res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).send(html);
  };
}
