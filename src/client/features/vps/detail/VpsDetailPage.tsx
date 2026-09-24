import { BUSY_STATUSES } from '@shared/constants/vps';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { VpsStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCan } from '@/features/auth/useAuth';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { VpsErrorReason } from '../ProvisionProgress';
import { useVps } from '../queries';
import { AccessTab } from './AccessTab';
import { BillingNotice } from './BillingNotice';
import { CopyButton } from './CopyButton';
import { HistoryTab } from './HistoryTab';
import { OverviewTab } from './OverviewTab';
import { ProvisionTimeline } from './ProvisionTimeline';
import { SettingsTab } from './SettingsTab';
import { VpsActions } from './VpsActions';

// noVNC e recharts são pesados: só baixam quando a aba é aberta.
const ConsoleTab = lazy(async () => ({ default: (await import('./ConsoleTab')).ConsoleTab }));
const MetricsTab = lazy(async () => ({ default: (await import('./MetricsTab')).MetricsTab }));

const TABS = ['overview', 'console', 'metrics', 'access', 'settings', 'history'] as const;
type Tab = (typeof TABS)[number];

/**
 * Página da VPS (/vps/:id, plano §14.5): cabeçalho com status e ações rápidas e as abas. A aba fica na URL (?tab=),
 * então dá para compartilhar o link do console ou voltar para a mesma aba. Atualiza sozinha pelo Socket.IO.
 */
export function VpsDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation('vps');
  const [params, setParams] = useSearchParams();
  const vps = useVps(id);
  const canConsole = useCan('vps:console:own');
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'overview';
  const setTab = (next: string) => setParams(next === 'overview' ? {} : { tab: next }, { replace: true });

  const back = (
    <Button asChild variant="link" className="w-fit px-0">
      <Link to="/vps">
        <ArrowLeft />
        {t('detail.back')}
      </Link>
    </Button>
  );

  if (vps.isPending) return <Skeleton className="h-96 w-full" />;
  if (!vps.data) {
    const notFound = vps.error instanceof ApiError && vps.error.status === 404;
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className={notFound ? 'text-muted-foreground' : 'text-destructive'}>
          {notFound ? t('detail.notFound') : errorMessage(vps.error)}
        </p>
      </div>
    );
  }
  const v = vps.data;
  const busy = BUSY_STATUSES.includes(v.status) && v.status !== 'PROVISIONING';

  return (
    <div className="flex flex-col gap-6" data-testid="vps-detail" data-status={v.status}>
      {back}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold sm:text-3xl">{v.hostname}</h1>
            <VpsStatusBadge status={v.status} />
            {busy ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                {t('detail.busy')}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {v.ip ? (
              <span className="inline-flex items-center gap-1 font-mono text-foreground" data-testid="vps-ip">
                {v.ip}
                <CopyButton value={v.ip} label={t('detail.copyIp')} />
              </span>
            ) : null}
            <span>{v.osTemplate.name}</span>
            <span>{v.plan.name}</span>
          </div>
          <VpsErrorReason vps={v} />
        </div>
        {v.status !== 'PENDING_PAYMENT' && v.status !== 'PROVISIONING' && v.status !== 'DELETED' ? (
          <VpsActions vps={v} onOpenConsole={() => setTab('console')} />
        ) : null}
      </header>

      {v.status === 'PENDING_PAYMENT' ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p>{t('detail.payPending')}</p>
            {v.pendingInvoice ? (
              <Button asChild>
                <Link to={`/checkout/${v.pendingInvoice.id}`}>{t('detail.payNow')}</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <BillingNotice vps={v} />

      {v.status === 'PROVISIONING' ? <ProvisionTimeline vps={v} /> : null}

      {v.status === 'DELETED' ? (
        <p className="text-muted-foreground">{t('detail.deletedTitle')}</p>
      ) : v.status !== 'PENDING_PAYMENT' && v.status !== 'PROVISIONING' ? (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden sm:w-fit">
            {TABS.filter((name) => name !== 'console' || canConsole).map((name) => (
              <TabsTrigger key={name} value={name} data-testid={`tab-${name}`}>
                {t(`detail.tabs.${name}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview">
            <OverviewTab vps={v} />
          </TabsContent>
          {canConsole ? (
            <TabsContent value="console">
              {tab === 'console' ? (
                <Suspense fallback={<Skeleton className="h-[70vh] w-full" />}>
                  <ConsoleTab vps={v} />
                </Suspense>
              ) : null}
            </TabsContent>
          ) : null}
          <TabsContent value="metrics">
            {tab === 'metrics' ? (
              <Suspense fallback={<Skeleton className="h-56 w-full" />}>
                <MetricsTab vps={v} />
              </Suspense>
            ) : null}
          </TabsContent>
          <TabsContent value="access">
            <AccessTab vps={v} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsTab vps={v} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryTab vps={v} />
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
