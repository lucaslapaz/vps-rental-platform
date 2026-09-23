import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, type ApiErrorDetail } from './api';

/**
 * Leva os erros de validação do servidor (400 VALIDATION_ERROR, com a chave de tradução de cada campo) para os
 * campos do formulário. Devolve true se algum campo recebeu erro.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!(error instanceof ApiError) || error.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return false;
  let applied = false;
  for (const d of error.details as ApiErrorDetail[]) {
    if ((fields as readonly string[]).includes(d.path)) {
      setError(d.path as Path<T>, { type: 'server', message: d.message });
      applied = true;
    }
  }
  return applied;
}
