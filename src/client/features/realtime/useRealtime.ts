import type { ClientToServerEvents, ServerToClientEvents } from '@shared/constants/events';
import type { VpsDTO } from '@shared/types/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/useAuth';
import { queryKeys } from '@/features/vps/queries';
import { apiGet, signalUnauthenticated } from '@/lib/api';

type FavoSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Tempo real (plano §13.2): enquanto há usuário logado, mantém um Socket.IO aberto (autenticado pelo cookie HttpOnly
 * da sessão, no handshake) e aplica os eventos no cache do TanStack Query: a tela muda sem refresh.
 */
export function useRealtime() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['vps', 'errors']);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const socket: FavoSocket = io({ path: '/socket.io', withCredentials: true });

    socket.on('vps:status', ({ vpsId, status, lastError }) => {
      const before = queryClient.getQueryData<VpsDTO[]>(queryKeys.vpsList)?.find((v) => v.id === vpsId);
      // Atualiza na hora (o badge muda sem esperar a rede) e depois busca a versão completa (IP, plano…).
      queryClient.setQueryData<VpsDTO[]>(queryKeys.vpsList, (list) =>
        list?.map((v) => (v.id === vpsId ? { ...v, status, ...(lastError === undefined ? {} : { lastError }) } : v)),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.vpsList });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoices });

      if (!before || before.status === status) return;
      if (before.status === 'PROVISIONING' && status === 'RUNNING') {
        void apiGet<{ vps: VpsDTO }>(`/vps/${vpsId}`)
          .then(({ vps }) => toast.success(t('vps:toast.ready', { hostname: vps.hostname, ip: vps.ip ?? '' })))
          .catch(() => undefined);
      } else if (status === 'ERROR') {
        toast.error(t('vps:toast.failed', { hostname: before.hostname }));
      }
    });

    socket.on('vps:progress', ({ vpsId, step }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vpsEvents(vpsId) });
      // O IP é reservado na etapa "ip": a lista já pode mostrá-lo.
      if (step === 'ip') void queryClient.invalidateQueries({ queryKey: queryKeys.vpsList, exact: true });
    });

    socket.on('session:revoked', () => {
      toast.info(t('errors:SESSION_REVOKED'));
      signalUnauthenticated();
    });

    return () => {
      socket.disconnect();
    };
  }, [userId, queryClient, t]);
}
