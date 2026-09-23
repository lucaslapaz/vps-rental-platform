import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, type ErrorBody } from '../../utils/errors.ts';

/** 404 em JSON para qualquer /api/* sem rota: a API nunca devolve o HTML da SPA por engano (plano §6). */
export const apiNotFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Rota não encontrada: ${req.method} ${req.originalUrl}`));
};

/**
 * Converte erros em `{ error: { code, message, details? } }`. Erros inesperados viram 500 genérico: a stack vai só
 * para o log. No Express 5, erros de handlers async chegam aqui sozinhos.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { code: err.code, message: err.message, ...(err.details === undefined ? {} : { details: err.details }) },
    };
    res.status(err.status).json(body);
    return;
  }
  // Corpo JSON malformado (express.json) e afins trazem status 4xx.
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) req.log?.error({ err }, 'erro não tratado');
  const body: ErrorBody = {
    error:
      status === 500
        ? { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' }
        : { code: 'BAD_REQUEST', message: 'Requisição inválida' },
  };
  res.status(status).json(body);
};
