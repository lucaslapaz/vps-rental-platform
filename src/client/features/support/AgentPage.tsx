import type { QueueItemDTO, SupportConversationDTO } from '@shared/types/support';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox, MessagesSquare } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, useCan } from '@/features/auth/useAuth';
import { useSocket } from '@/features/realtime/RealtimeProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel';
import { supportKeys, useMyConversations, useQueue } from './queries';

/**
 * /agent (plano §13): fila ao vivo (evento `support:queue:updated` na sala `agents`), "Iniciar atendimento" atômico
 * (409 ALREADY_CLAIMED se outro técnico foi mais rápido), atendimentos em andamento e o chat do selecionado (?c=id).
 */
export function AgentPage() {
  const { t, i18n } = useTranslation('support');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const { user } = useAuth();
  const canClaim = useCan('support:conversation:claim');
  const canClose = useCan('support:conversation:close');
  const socket = useSocket();
  const queryClient = useQueryClient();
  const queue = useQueue();
  const mine = useMyConversations();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('c');
  const selected = mine.data?.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!socket) return;
    const onQueue = ({ waiting }: { waiting: QueueItemDTO[] }) => queryClient.setQueryData(supportKeys.queue, waiting);
    const onUpdated = () => void queryClient.invalidateQueries({ queryKey: supportKeys.mine });
    // Depois de uma queda, a fila pode ter mudado sem que o evento chegasse.
    const onReconnect = () => void queryClient.invalidateQueries({ queryKey: ['support'] });
    socket.on('support:queue:updated', onQueue);
    socket.on('support:conversation:updated', onUpdated);
    socket.io.on('reconnect', onReconnect);
    return () => {
      socket.off('support:queue:updated', onQueue);
      socket.off('support:conversation:updated', onUpdated);
      socket.io.off('reconnect', onReconnect);
    };
  }, [socket, queryClient]);

  // O atendimento selecionado foi encerrado pelo cliente ou devolvido: sai da tela.
  useEffect(() => {
    if (selectedId && mine.data && !selected) setParams({}, { replace: true });
  }, [selectedId, mine.data, selected, setParams]);

  const act = async (path: string, success: string, after?: (c: SupportConversationDTO) => void) => {
    try {
      const { conversation } = await api<{ conversation: SupportConversationDTO }>('POST', path);
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: supportKeys.mine });
      after?.(conversation);
    } catch (err) {
      toast.error(errorMessage(err));
      await queryClient.invalidateQueries({ queryKey: supportKeys.queue });
    }
  };

  if (!user) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="flex flex-col gap-6" data-testid="agent-page">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold">{t('agent.title')}</h1>
        <p className="text-muted-foreground">{t('agent.subtitle')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox className="size-4" aria-hidden />
                {t('agent.queueTitle')}
                {queue.data?.length ? (
                  <span className="rounded-full bg-status-pending/15 px-2 text-xs text-status-pending tabular-nums">
                    {queue.data.length}
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {queue.isPending ? <Skeleton className="h-24 w-full" /> : null}
              {queue.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t('agent.queueEmpty')}</p> : null}
              <ul className="flex flex-col gap-3" data-testid="queue">
                {queue.data?.map((q) => (
                  <li key={q.id} className="flex flex-col gap-1.5 rounded-lg border p-3" data-conversation={q.id}>
                    <span className="font-medium">{q.subject}</span>
                    <span className="text-xs text-muted-foreground">
                      {q.customer.name} · {q.customer.email}
                    </span>
                    <span className="line-clamp-2 text-sm">{q.preview}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('agent.waitingSince', { time: formatDateTime(q.createdAt, locale) })}
                    </span>
                    {canClaim ? (
                      <Button
                        size="sm"
                        className="mt-1 w-fit"
                        onClick={() => void act(`/support/conversations/${q.id}/claim`, t('agent.claimed'), (c) => setParams({ c: c.id }))}
                        data-testid="claim"
                      >
                        {t('agent.claim')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessagesSquare className="size-4" aria-hidden />
                {t('agent.mineTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mine.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t('agent.mineEmpty')}</p> : null}
              <ul className="flex flex-col gap-1" data-testid="mine">
                {mine.data?.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setParams({ c: c.id })}
                      aria-current={c.id === selectedId ? 'true' : undefined}
                      className={cn(
                        'flex w-full flex-col rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                        c.id === selectedId && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="font-medium">{c.customer.name}</span>
                      <span className="truncate text-xs text-muted-foreground">{c.subject}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card>
          {selected ? (
            <>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle>{selected.subject}</CardTitle>
                  <CardDescription>
                    {t('agent.customer')}: {selected.customer.name} · {selected.customer.email}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void act(`/support/conversations/${selected.id}/release`, t('agent.released'), () => setParams({}))}
                  >
                    {t('agent.release')}
                  </Button>
                  {canClose ? (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void act(`/support/conversations/${selected.id}/close`, t('agent.closed'), () => setParams({}))}
                    >
                      {t('agent.close')}
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <ChatPanel conversation={selected} viewerId={user.id} />
              </CardContent>
            </>
          ) : (
            <CardContent className="flex min-h-72 items-center justify-center text-muted-foreground">{t('agent.select')}</CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
