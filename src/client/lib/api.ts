/**
 * Cliente HTTP da API (mesma origem, plano §14.2):
 * - lê o cookie `csrf` A CADA requisição e o envia no header X-CSRF-Token (cookie-to-header, §9.2);
 * - em 403 CSRF_INVALID, pede um token novo (GET /api/auth/csrf) e repete a requisição UMA vez;
 * - em 401 fora do /auth/me, avisa o app (onUnauthenticated), que limpa o cache e manda para o login.
 */
export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Lista de campos (VALIDATION_ERROR) ou dados do erro (ex.: { failureCode } no PAYMENT_DECLINED). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const CSRF_COOKIES = ['__Host-csrf', 'csrf'];
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

const csrfToken = () => CSRF_COOKIES.map(readCookie).find(Boolean);

let unauthenticatedHandler: (() => void) | undefined;
/** Registrado pelo app: o que fazer quando uma chamada autenticada recebe 401 (sessão expirada ou revogada). */
export function onUnauthenticated(handler: () => void) {
  unauthenticatedHandler = handler;
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = UNSAFE.has(method) ? csrfToken() : undefined;
  if (token) headers['X-CSRF-Token'] = token;
  try {
    return await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sem conexão com o servidor');
  }
}

async function toError(res: Response): Promise<ApiError> {
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  return new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? res.statusText, data?.error?.details);
}

export async function api<T = void>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res = await send(method, path, body);
  if (res.status === 403 && UNSAFE.has(method)) {
    const error = await toError(res.clone());
    if (error.code === 'CSRF_INVALID') {
      await send('GET', '/auth/csrf');
      res = await send(method, path, body);
    }
  }
  if (!res.ok) {
    const error = await toError(res);
    if (error.status === 401 && path !== '/auth/me' && path !== '/auth/login') unauthenticatedHandler?.();
    throw error;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const apiGet = <T>(path: string) => api<T>('GET', path);
