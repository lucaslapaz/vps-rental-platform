import type { VpsDTO } from '@shared/types/catalog';
import { KeyRound, RotateCw, ShieldCheck, ShieldOff, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/features/auth/useAuth';
import { formatBytes, formatDateTime, formatDuration, formatPercent } from '@/lib/format';
import { formatMemory, useVpsLive } from '../queries';
import { CopyButton } from './CopyButton';
import { useVpsCommand } from './useVpsCommand';

function Meter({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{detail}</span>
      </div>
      <Progress value={value === null ? 0 : Math.min(100, value * 100)} aria-label={label} />
    </div>
  );
}

/** Aba Visão geral (plano §14.5): uso ao vivo, comando SSH pronto e o resumo do acesso. */
export function OverviewTab({ vps }: { vps: VpsDTO }) {
  const { t, i18n } = useTranslation('vps');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const running = vps.status === 'RUNNING';
  const live = useVpsLive(vps.id, running);
  const canManage = useCan('vps:manage:own');
  const reboot = useVpsCommand(vps.id, () => ({ method: 'POST', path: `/vps/${vps.id}/actions/reboot` }), {
    success: () => t('detail.actions.requested', { hostname: vps.hostname }),
  });
  const ssh = vps.ip ? `ssh ${vps.username}@${vps.ip}` : null;
  const l = live.data;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {l?.pendingReboot && running ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-status-pending/40 bg-status-pending/10 p-3 text-sm lg:col-span-2">
          <RotateCw className="size-4 text-status-pending" aria-hidden />
          <span className="flex-1">{t('detail.overview.pendingReboot')}</span>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => reboot.mutate()} disabled={reboot.isPending}>
              {t('detail.overview.rebootNow')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.overview.usage')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!running ? (
            <p className="text-sm text-muted-foreground">{t('detail.overview.offline')}</p>
          ) : !l ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <>
              <Meter label={t('detail.overview.cpu')} value={l.cpu} detail={formatPercent(l.cpu, locale)} />
              <Meter
                label={t('detail.overview.memory')}
                value={l.memMaxBytes ? l.memUsedBytes / l.memMaxBytes : null}
                detail={t('detail.overview.usedOf', {
                  used: formatBytes(l.memUsedBytes, locale),
                  total: formatBytes(l.memMaxBytes, locale),
                })}
              />
              <Meter
                label={t('detail.overview.disk')}
                value={l.disk ? l.disk.usedBytes / l.disk.totalBytes : null}
                detail={
                  l.disk
                    ? t('detail.overview.usedOf', {
                        used: formatBytes(l.disk.usedBytes, locale),
                        total: formatBytes(l.disk.totalBytes, locale),
                      })
                    : t('detail.overview.unavailable')
                }
              />
              <p className="text-sm text-muted-foreground">
                {t('detail.overview.uptime')}:{' '}
                <span className="tabular-nums text-foreground">{formatDuration(l.uptimeSeconds, locale)}</span>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('detail.overview.specs')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('detail.overview.cpu')}</dt>
            <dd>{t('detail.overview.vcpu', { count: vps.cores })}</dd>
            <dt className="text-muted-foreground">{t('detail.overview.memory')}</dt>
            <dd>{formatMemory(vps.memoryMb, locale)}</dd>
            <dt className="text-muted-foreground">{t('detail.overview.disk')}</dt>
            <dd>{vps.diskGb} GB</dd>
            <dt className="text-muted-foreground">{t('detail.metrics.network')}</dt>
            <dd>{t('detail.overview.bandwidth', { value: vps.bandwidthMbps })}</dd>
            <dt className="text-muted-foreground">{t('list.columns.plan')}</dt>
            <dd>{vps.plan.name}</dd>
            <dt className="text-muted-foreground">{t('detail.overview.created')}</dt>
            <dd>{formatDateTime(vps.createdAt, locale)}</dd>
            {vps.paidUntil ? (
              <>
                <dt className="text-muted-foreground">{t('detail.overview.paidUntil')}</dt>
                <dd data-testid="paid-until">{formatDateTime(vps.paidUntil, locale)}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="size-4" aria-hidden />
            {t('detail.overview.sshTitle')}
          </CardTitle>
          <CardDescription>{t('detail.overview.sshHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {ssh ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
              <code className="flex-1 truncate font-mono text-sm" data-testid="ssh-command">
                {ssh}
              </code>
              <CopyButton value={ssh} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('list.ipPending')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden />
            {t('detail.overview.accessTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex items-center gap-2">
              {vps.sshPasswordAuth ? (
                <ShieldOff className="size-4 text-status-pending" />
              ) : (
                <ShieldCheck className="size-4 text-status-running" />
              )}
              {vps.sshPasswordAuth ? t('detail.overview.sshPasswordOn') : t('detail.overview.sshPasswordOff')}
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-status-running" />
              {t('detail.overview.rootSsh')}
            </li>
            <li className="text-muted-foreground">
              {vps.rootPasswordSet ? t('detail.overview.rootSet') : t('detail.overview.rootNotSet')}
            </li>
            <li className="text-muted-foreground">{t('detail.overview.sudo', { sudo: vps.osTemplate.sudoCommand })}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
