/**
 * Cliente HTTP da API (mesma origem). Nesta fase só faz GET e converte erros; a Fase 3 acrescenta o header
 * X-CSRF-Token, a nova tentativa em CSRF_INVALID e o redirecionamento em 401 (plano §14.2).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}
