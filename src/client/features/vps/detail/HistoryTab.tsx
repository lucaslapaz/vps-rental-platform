import type { VpsDTO } from '@shared/types/catalog';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { translateKey } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useVpsEvents } from '../queries';

const TONE: Record<string, string> = {
  succeeded: 'bg-status-running',
  failed: 'bg-status-error',
  requested: 'bg-status-pending',
  progress: 'bg-status-stopped',
};

/** Detalhe legível de um evento (mensagens gravadas como códigos ou valores simples). */
function detail(action: string, message: string | null, t: ReturnType<typeof useTranslation<'vps'>>['t']) {
  if (!message) return null;
  if (action === 'resize' && message === 'PENDING_REBOOT') return t('detail.history.pendingReboot');
  if (action === 'password') return message === 'root' ? 'root' : null;
  if (/^[A-Z_]+$/.test(message)) return translateKey(`vps:lastError.${message}`, message);
  return message;
}

/** Aba Histórico: eventos da VPS (VpsEvent), do mais recente para o mais antigo. */
export function HistoryTab({ vps }: { vps: VpsDTO }) {
  const { t, i18n } = useTranslation('vps');
  const events = useVpsEvents(vps.id);
  const locale = i18n.resolvedLanguage ?? 'pt-BR';

  if (events.isPending) return <Skeleton className="h-48 w-full" />;
  const rows = [...(events.data ?? [])].reverse();
  if (!rows.length) return <p className="text-muted-foreground">{t('detail.history.empty')}</p>;

  return (
    <Card>
      <CardContent>
        <ol className="flex flex-col divide-y" data-testid="vps-history">
          {rows.map((e) => {
            // Etapas da criação: a própria etapa é o título (sem "em andamento", que não faz sentido depois de concluída).
            const isStep = e.action === 'provision';
            const title = isStep
              ? translateKey(`vps:progress.${e.message}`, e.message ?? '')
              : translateKey(`vps:detail.history.actions.${e.action}`, e.action);
            const extra = isStep ? null : detail(e.action, e.message, t);
            return (
              <li key={e.id} className="flex items-start gap-3 py-2.5">
                <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', TONE[e.status] ?? 'bg-status-stopped')} />
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="text-sm">
                    <span className={isStep ? 'text-muted-foreground' : 'font-medium'}>{title}</span>
                    {isStep ? null : (
                      <span className="text-muted-foreground"> · {translateKey(`vps:detail.history.status.${e.status}`, e.status)}</span>
                    )}
                  </span>
                  {extra ? (
                    // Códigos (MAIÚSCULAS) viram texto traduzido; o resto (IP, hostname, fingerprint) é valor técnico.
                    <span className={cn('text-xs text-muted-foreground', !/^[A-Z_]+$/.test(e.message ?? '') && 'font-mono')}>{extra}</span>
                  ) : null}
                </div>
                <time className="text-xs text-muted-foreground tabular-nums" dateTime={e.createdAt}>
                  {formatDateTime(e.createdAt, locale)}
                </time>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
