import type { RequestHandler } from 'express';
import type { Permission } from '../../../shared/constants/permissions.ts';
import type { Env } from '../../config/env.ts';
import type { SessionService } from '../../services/SessionService.ts';
import { AppError } from '../../utils/errors.ts';
import { cookieNames } from '../cookies.ts';

/**
 * Autenticação pelo cookie de sessão (plano §9.5): cookie `sid` → hash → sessão + usuário + role + permissões (uma
 * consulta) → `req.user`. `required: false` é o `optionalAuthenticate` (segue sem `req.user`).
 */
export function authenticate(env: Env, sessions: SessionService, { required = true } = {}): RequestHandler {
  const name = cookieNames(env).session;
  return async (req, _res, next) => {
    const token = req.cookies?.[name];
    const result = typeof token === 'string' && token ? await sessions.authenticate(token) : null;
    if (result) {
      req.user = result.user;
      return next();
    }
    if (required) return next(new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar'));
    next();
  };
}

/** 403 se o usuário não tiver TODAS as permissões pedidas. Sempre depois de `authenticate`. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Faça login para continuar'));
    if (!permissions.every((p) => req.user?.can(p))) return next(new AppError(403, 'FORBIDDEN', 'Você não tem permissão para isso'));
    next();
  };
}
