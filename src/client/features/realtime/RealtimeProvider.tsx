import type { ClientToServerEvents, ServerToClientEvents } from '@shared/constants/events';
import type { VpsDTO } from '@shared/types/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/useAuth';
import { queryKeys } from '@/features/vps/queries';
import { apiGet, signalUnauthenticated } from '@/lib/api';

export type FavoSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const RealtimeContext = createContext<FavoSocket | null>(null);

/** O socket da sessão (ou null sem login / antes de conectar). Telas como o chat registram os próprios eventos nele. */
export function useSocket() {
  return useContext(RealtimeContext);
}

/**
 * Tempo real (plano §13.2): enquanto há usuário logado, mantém UM Socket.IO aberto (autenticado pelo cookie HttpOnly
 * da sessão, no handshake) e aplica os eventos globais (VPS, sessão) no cache do TanStack Query: a tela muda sem refresh.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['vps', 'errors']);
  // Pelo ref: trocar de idioma não pode derrubar e reabrir o socket.
  const tRef = useRef(t);
  tRef.current = t;
  const [socket, setSocket] = useState<FavoSocket | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    const s: FavoSocket = io({ path: '/socket.io', withCredentials: true });
    setSocket(s);

    s.on('vps:status', ({ vpsId, status, lastError }) => {
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
          .then(({ vps }) => toast.success(tRef.current('vps:toast.ready', { hostname: vps.hostname, ip: vps.ip ?? '' })))
          .catch(() => undefined);
      } else if (status === 'ERROR') {
        toast.error(tRef.current('vps:toast.failed', { hostname: before.hostname }));
      }
    });

    s.on('vps:progress', ({ vpsId, step }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.vpsEvents(vpsId) });
      // O IP é reservado na etapa "ip": a lista já pode mostrá-lo.
      if (step === 'ip') void queryClient.invalidateQueries({ queryKey: queryKeys.vpsList, exact: true });
    });

    s.on('session:revoked', () => {
      toast.info(tRef.current('errors:SESSION_REVOKED'));
      signalUnauthenticated();
    });

    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [userId, queryClient]);

  return <RealtimeContext.Provider value={socket}>{children}</RealtimeContext.Provider>;
}
