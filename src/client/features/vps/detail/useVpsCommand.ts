import type { VpsDTO } from '@shared/types/catalog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '../queries';

type Method = 'POST' | 'PATCH' | 'DELETE';

/**
 * Comando sobre uma VPS (ação, troca de plano, acesso…): chama a API, põe a VPS devolvida no cache e mostra o toast.
 * Erros viram mensagem traduzida pelo código, a não ser que quem chama trate (onError devolvendo true).
 */
export function useVpsCommand<TBody = void>(
  vpsId: string,
  build: (body: TBody) => { method: Method; path: string; body?: unknown },
  options: { success?: (vps: VpsDTO) => string; onError?: (err: unknown) => boolean } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: TBody) => {
      const req = build(body);
      return (await api<{ vps: VpsDTO }>(req.method, req.path, req.body)).vps;
    },
    onSuccess: async (vps) => {
      queryClient.setQueryData(queryKeys.vps(vpsId), vps);
      if (options.success) toast.success(options.success(vps));
      await queryClient.invalidateQueries({ queryKey: queryKeys.vpsList });
    },
    onError: (err) => {
      if (!options.onError?.(err)) toast.error(errorMessage(err));
    },
  });
}
