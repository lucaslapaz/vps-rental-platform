import type { HealthResponse } from '@shared/types/health';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type State = 'checking' | 'online' | 'offline';
const DOT: Record<State, string> = { checking: 'bg-status-pending', offline: 'bg-status-error', online: 'bg-status-running' };

/** O /api/health responde 503 (com o mesmo corpo) quando o banco cai: ler o JSON nos dois casos. */
async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health', { headers: { Accept: 'application/json' } });
  if (res.status !== 200 && res.status !== 503) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as HealthResponse;
}

function StatusRow({ label, state }: { label: string; state: State }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-2 font-medium">
        <span aria-hidden className={cn('size-2 rounded-full', DOT[state], state === 'checking' && 'animate-pulse')} />
        {t(`status.${state}`)}
      </span>
    </div>
  );
}

/** Cartão com o estado da API e do banco (GET /api/health). Status sempre com ponto + texto, nunca só com cor. */
export function SystemStatus() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 30_000 });

  const api: State = health.isPending ? 'checking' : health.isError ? 'offline' : 'online';
  const database: State = health.data
    ? health.data.checks.database === 'ok'
      ? 'online'
      : 'offline'
    : api === 'checking'
      ? 'checking'
      : 'offline';

  return (
    <Card size="sm" data-testid="system-status">
      <CardHeader>
        <CardTitle className="font-heading">{t('status.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <StatusRow label={t('status.api')} state={api} />
        <StatusRow label={t('status.database')} state={database} />
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
