import type { VpsDTO } from '@shared/types/catalog';
import { Check, Circle, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { provisionState } from '../provisionSteps';
import { useVpsEvents } from '../queries';

/**
 * Linha do tempo da criação (plano §14.5), ao vivo: cada `vps:progress` invalida o histórico, que guarda as etapas com
 * horário. Reconstruída do banco, então sobrevive a um refresh.
 */
export function ProvisionTimeline({ vps }: { vps: VpsDTO }) {
  const { t, i18n } = useTranslation('vps');
  const events = useVpsEvents(vps.id, vps.status === 'PROVISIONING');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';

  const { mode, steps, reached, lastIndex } = provisionState(events.data);

  return (
    <Card data-testid="provision-timeline">
      <CardHeader>
        <CardTitle className="font-heading text-xl">
          {mode === 'reinstall' ? t('detail.timeline.titleReinstall') : t('detail.timeline.title')}
        </CardTitle>
        <CardDescription>{t('detail.timeline.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => {
            const at = reached.get(step);
            const done = at !== undefined && (i < lastIndex || step === 'ready');
            const current = i === lastIndex && step !== 'ready';
            return (
              <li key={step} className="flex items-center gap-3" data-step={step} data-state={done ? 'done' : current ? 'current' : 'todo'}>
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border',
                    done && 'border-status-running bg-status-running/10 text-status-running',
                    current && 'border-status-pending text-status-pending',
                    !done && !current && 'text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {done ? (
                    <Check className="size-4" />
                  ) : current ? (
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Circle className="size-3" />
                  )}
                </span>
                <span className={cn('flex-1', !done && !current && 'text-muted-foreground', current && 'font-medium')}>
                  {t(`progress.${step}`)}
                </span>
                {at ? <time className="text-xs text-muted-foreground tabular-nums">{formatDateTime(at, locale)}</time> : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
