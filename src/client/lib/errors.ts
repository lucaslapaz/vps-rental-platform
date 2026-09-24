import { ApiError } from './api';
import i18n from './i18n';
import { permissionI18nKey } from './permissionKeys';

// As chaves aqui são dinâmicas (vêm do servidor ou do zod), então não dá para usar o t() tipado; o defaultValue cobre
// códigos sem tradução. Os componentes que chamam estes helpers já re-renderizam ao trocar de idioma (useTranslation).
const translate = i18n.t.bind(i18n) as unknown as (key: string, options?: { defaultValue?: string } & Record<string, unknown>) => string;

/** Mensagem traduzida para um erro da API, pelo `code` (errors:<code>); códigos desconhecidos viram a genérica. */
export function errorMessage(error: unknown): string {
  const code = error instanceof ApiError ? error.code : 'generic';
  return translate(`errors:${code}`, { defaultValue: translate('errors:generic') });
}

/** Traduz a chave de validação do zod/servidor: "passwordTooShort" → errors:validation.passwordTooShort. */
export function validationMessage(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return translate(`errors:validation.${key}`, { defaultValue: key });
}

/** Texto de uma chave montada em tempo de execução (ex.: ação do histórico), com um texto de reserva. */
export function translateKey(key: string, fallback: string, params: Record<string, unknown> = {}): string {
  return translate(key, { defaultValue: fallback, ...params });
}

/** Nome da role no idioma atual; roles criadas depois (sem tradução) mostram o nome cadastrado. */
export function roleLabel(key: string, fallback?: string): string {
  return translate(`common:roles.${key}`, { defaultValue: fallback ?? key });
}

/** Descrição da permissão no idioma atual (a do código, em pt-BR, como reserva). */
export function permissionLabel(permission: string, fallback?: string): string {
  return translate(`admin:permissions.${permissionI18nKey(permission)}`, { defaultValue: fallback ?? permission });
}
