import type { HealthResponse } from '@shared/types/health';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Cartão com o estado da API (GET /api/health). Status sempre com ponto + texto, nunca só com cor. */
export function SystemStatus() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ['health'], queryFn: () => apiGet<HealthResponse>('/health'), refetchInterval: 30_000 });

  const state = health.isPending ? 'checking' : health.isError ? 'offline' : 'online';
  const dot = { checking: 'bg-status-pending', offline: 'bg-status-error', online: 'bg-status-running' }[state];

  return (
    <Card size="sm" data-testid="system-status">
      <CardHeader>
        <CardTitle className="font-heading">{t('status.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t('status.api')}</span>
          <span className="inline-flex items-center gap-2 font-medium">
            <span aria-hidden className={cn('size-2 rounded-full', dot, state === 'checking' && 'animate-pulse')} />
            {t(`status.${state}`)}
          </span>
        </div>
        {health.data ? (
          <div className="flex items-center justify-between text-muted-foreground">
            <span>
              {t('status.environment')}: <span className="font-mono">{health.data.environment}</span>
            </span>
            <span className="font-mono text-xs">{t('status.uptime', { seconds: health.data.uptimeSeconds })}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
