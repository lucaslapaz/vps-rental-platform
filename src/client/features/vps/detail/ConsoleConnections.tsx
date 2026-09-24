import type { ConsoleConnectionDTO } from '@shared/types/catalog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Monitor, SquareTerminal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { queryKeys, useConsoleConnections } from '../queries';

/**
 * Conexões de console do usuário (de todas as VPS, abas e dispositivos), com o limite em uso. Encerrar uma libera a
 * vaga na hora: o servidor fecha o WebSocket dela e o lado do Proxmox. `currentId` marca a conexão desta aba.
 */
export function ConsoleConnections({ currentId, onTerminateCurrent }: { currentId: string | null; onTerminateCurrent: () => void }) {
  const { t, i18n } = useTranslation('vps');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const queryClient = useQueryClient();
  const connections = useConsoleConnections();
  const terminate = useMutation({
    mutationFn: (c: ConsoleConnectionDTO) => api('DELETE', `/consoles/${c.id}`),
    onSuccess: async (_, c) => {
      if (c.id === currentId) onTerminateCurrent();
      toast.success(t('detail.console.connections.terminated', { hostname: c.hostname }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.consoles });
    },
    onError: async (err) => {
      toast.error(errorMessage(err));
      await queryClient.invalidateQueries({ queryKey: queryKeys.consoles });
    },
  });

  const list = connections.data?.connections ?? [];
  const limit = connections.data?.limit ?? 0;
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' });
  const full = limit > 0 && list.length >= limit;

  return (
    <section className="rounded-lg border p-3 text-sm" aria-labelledby="console-connections-title" data-testid="console-connections">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="console-connections-title" className="font-medium">
          {t('detail.console.connections.title')}
        </h2>
        {limit > 0 ? (
          <span
            className={cn('text-xs', full ? 'font-medium text-destructive' : 'text-muted-foreground')}
            data-testid="console-connections-usage"
          >
            {t('detail.console.connections.usage', { used: list.length, limit })}
          </span>
        ) : null}
      </div>
      {full ? <p className="mt-1 text-xs text-muted-foreground">{t('detail.console.connections.fullHint')}</p> : null}
      {list.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t('detail.console.connections.empty')}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y">
          {list.map((c) => {
            const Icon = c.type === 'vnc' ? Monitor : SquareTerminal;
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
                data-testid="console-connection"
                data-state={c.state}
              >
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-mono">{c.hostname}</span>
                <span className="text-muted-foreground">
                  {c.type === 'vnc' ? t('detail.console.modeVnc') : t('detail.console.modeSerial')}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                  <span
                    aria-hidden
                    className={cn(
                      'size-2 rounded-full',
                      c.state === 'open' ? 'bg-status-running' : 'bg-status-pending animate-pulse motion-reduce:animate-none',
                    )}
                  />
                  {c.state === 'open' ? t('detail.console.connections.open') : t('detail.console.connections.connecting')}
                </span>
                {c.id === currentId ? (
                  <span className="text-xs font-medium text-link">{t('detail.console.connections.thisTab')}</span>
                ) : !c.sameSession ? (
                  <span className="text-xs text-muted-foreground">{t('detail.console.connections.otherDevice')}</span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {t('detail.console.connections.since', { time: time.format(new Date(c.since)) })}
                </span>
                <span className="flex-1" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => terminate.mutate(c)}
                  disabled={terminate.isPending && terminate.variables?.id === c.id}
                  data-testid="console-connection-terminate"
                >
                  <X />
                  {t('detail.console.connections.terminate')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
