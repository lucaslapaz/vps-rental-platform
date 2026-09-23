import type { Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { AppError } from '../../utils/errors.ts';

type Part = 'body' | 'params' | 'query';
type Schemas = Partial<Record<Part, z.ZodType>>;

/**
 * Valida body/params/query com os schemas zod de src/shared (plano §9.5). O resultado já transformado fica em
 * `res.locals.valid` (no Express 5 o `req.query` é somente leitura). Erro → 400 VALIDATION_ERROR com a lista de
 * campos e a CHAVE de tradução de cada mensagem.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    const valid: Partial<Record<Part, unknown>> = {};
    const details: { path: string; message: string }[] = [];
    for (const part of Object.keys(schemas) as Part[]) {
      const result = (schemas[part] as z.ZodType).safeParse(req[part] ?? {});
      if (result.success) valid[part] = result.data;
      else details.push(...result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    if (details.length) return next(new AppError(400, 'VALIDATION_ERROR', 'Dados inválidos', details));
    res.locals.valid = valid;
    next();
  };
}

/** Lê a parte validada com o tipo de saída do schema. */
export function valid<S extends z.ZodType>(res: Response, part: Part, _schema: S): z.output<S> {
  return (res.locals.valid as Record<Part, unknown>)[part] as z.output<S>;
}

/** IP e user agent para a sessão e o AuditLog. */
export function requestMeta(req: Request) {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}
