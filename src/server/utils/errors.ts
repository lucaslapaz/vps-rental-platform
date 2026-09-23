/**
 * Erro de aplicação com um código estável. O frontend traduz pelo `code` (errors.<code>), então o servidor nunca
 * precisa saber o idioma do usuário (plano §14.4).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static notFound(message = 'Recurso não encontrado') {
    return new AppError(404, 'NOT_FOUND', message);
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}
