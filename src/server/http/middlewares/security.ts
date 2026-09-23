import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Env } from '../../config/env.ts';
import type { CsrfService } from '../../services/CsrfService.ts';
import { AppError } from '../../utils/errors.ts';
import { cookieNames } from '../cookies.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Verificação de origem (Fetch Metadata + Origin, OWASP; plano §9.3) em métodos que alteram estado.
 * Aceita a origem configurada (APP_ORIGIN) e a própria origem do servidor (mesmo host da requisição). Clientes que não
 * enviam Origin nem Sec-Fetch-Site (curl, testes) passam por aqui, mas continuam precisando do token CSRF.
 */
export function originCheck(env: Env): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get('sec-fetch-site') === 'cross-site') return next(new AppError(403, 'ORIGIN_INVALID', 'Origem não permitida'));
    const origin = req.get('origin');
    if (origin) {
      const selfOrigin = `${req.protocol}://${req.get('host')}`;
      if (origin !== env.APP_ORIGIN && origin !== selfOrigin) return next(new AppError(403, 'ORIGIN_INVALID', 'Origem não permitida'));
    }
    next();
  };
}

/**
 * CSRF (plano §9.2): em POST/PUT/PATCH/DELETE, o header X-CSRF-Token precisa ser igual ao cookie `csrf` e ter uma
 * assinatura HMAC válida para o binding atual (sessão ou pré-sessão). Não consulta o banco, por isso roda ANTES da
 * autenticação, na ordem pedida (originCheck → csrf → authenticate).
 */
export function csrfProtection(env: Env, csrf: CsrfService): RequestHandler {
  const names = cookieNames(env);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const header = req.get('x-csrf-token');
    const cookie = req.cookies?.[names.csrf];
    if (!header || typeof cookie !== 'string' || header !== cookie || !csrf.verify(header, csrf.bindingFor(req))) {
      return next(new AppError(403, 'CSRF_INVALID', 'Token CSRF ausente ou inválido'));
    }
    next();
  };
}
