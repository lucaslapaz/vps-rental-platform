import type { Permission } from '@shared/constants/permissions';
import type { PublicUser } from '@shared/types/auth';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '@/lib/api';

export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** Busca o usuário logado; 401 vira `null` (visitante), não erro. */
async function fetchMe(): Promise<PublicUser | null> {
  try {
    return (await apiGet<{ user: PublicUser }>('/auth/me')).user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/** Estado de autenticação do app (plano §14.2): consultado uma vez e mantido em cache pelo TanStack Query. */
export function useAuth() {
  const query = useQuery({ queryKey: ME_QUERY_KEY, queryFn: fetchMe, retry: false, staleTime: Number.POSITIVE_INFINITY });
  return { user: query.data ?? null, isPending: query.isPending, isError: query.isError };
}

/** `useCan('vps:create')`: esconde botões e rotas. É só experiência de uso; quem decide é o servidor (§9.7). */
export function useCan(permission: Permission): boolean {
  const { user } = useAuth();
  return Boolean(user?.permissions.includes(permission));
}
