import { ADMIN_JOB_STATUSES } from '@shared/schemas/admin';
import type { AdminJobDTO, AdminJobStatus, AdminOverviewDTO } from '@shared/types/admin';
import { useQuery } from '@tanstack/react-query';
import { Cpu, HardDrive, MemoryStick, ServerOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { VpsStatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { formatBrl } from '@/lib/currency';
import { roleLabel } from '@/lib/errors';
import { formatBytes, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AdminNav } from './AdminNav';

const JOB_DOT: Record<AdminJobStatus, string> = {
  QUEUED: 'bg-status-pending',
  RUNNING: 'bg-status-pending animate-pulse motion-reduce:animate-none',
  SUCCEEDED: 'bg-status-running',
  FAILED: 'bg-status-error',
};

/** Barra de uso com rótulo e texto (a cor nunca é a única informação). */
function Meter({ label, used, total, text, icon: Icon }: { label: string; used: number; total: number; text: string; icon: typeof Cpu }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {label}
        </span>
        <span className="text-muted-foreground">{text}</span>
      </div>
      <Progress value={pct} aria-label={label} className="h-2" />
    </div>
  );
}

/** Administração → Visão geral (plano §17, Fase 10): capacidade do nó, uso da plataforma e a fila de jobs. */
export function AdminOverviewPage() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const [jobStatus, setJobStatus] = useState<AdminJobStatus | 'ALL'>('ALL');
  const [periodic, setPeriodic] = useState(false);
  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => (await apiGet<{ overview: AdminOverviewDTO }>('/admin/overview')).overview,
    refetchInterval: 15_000,
  });
  const jobs = useQuery({
    queryKey: ['admin', 'jobs', jobStatus, periodic],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (jobStatus !== 'ALL') params.set('status', jobStatus);
      if (periodic) params.set('periodic', 'true');
      const qs = params.toString();
      return (await apiGet<{ jobs: AdminJobDTO[] }>(`/admin/jobs${qs ? `?${qs}` : ''}`)).jobs;
    },
    refetchInterval: 10_000,
  });
  const o = overview.data;
  const jobLabel = (s: AdminJobStatus) => t(`admin:overview.jobStatuses.${s}`);

  return (
    <div className="flex flex-col gap-6">
      <AdminNav />
      <header>
        <h1 className="text-3xl font-extrabold">{t('admin:overview.title')}</h1>
        <p className="text-muted-foreground">{t('admin:overview.subtitle')}</p>
      </header>

      {!o ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2" data-testid="admin-node">
            <CardHeader>
              <CardTitle>{t('admin:overview.node', { name: o.node?.name ?? '—' })}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {o.node ? (
                <>
                  <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Cpu aria-hidden className="size-4" />
                    {t('admin:overview.cpus', { count: o.node.cpuCount, version: o.node.pveVersion })}
                  </p>
                  <Meter
                    icon={MemoryStick}
                    label={t('admin:overview.memory')}
                    used={o.node.memTotalBytes - o.node.memAvailableBytes}
                    total={o.node.memTotalBytes}
                    text={t('admin:overview.availableOf', {
                      available: formatBytes(o.node.memAvailableBytes, locale),
                      total: formatBytes(o.node.memTotalBytes, locale),
                    })}
                  />
                  <Meter
                    icon={HardDrive}
                    label={t('admin:overview.storage')}
                    used={o.node.storageTotalBytes - o.node.storageAvailBytes}
                    total={o.node.storageTotalBytes}
                    text={t('admin:overview.availableOf', {
                      available: formatBytes(o.node.storageAvailBytes, locale),
                      total: formatBytes(o.node.storageTotalBytes, locale),
                    })}
                  />
                </>
              ) : (
                <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <ServerOff aria-hidden className="size-4" />
                  {t('admin:overview.nodeOffline')}
                </p>
              )}
              <div className="flex flex-col gap-3 border-t pt-4">
                <h3 className="text-sm font-medium">{t('admin:overview.allocation')}</h3>
                <Meter
                  icon={MemoryStick}
                  label={t('admin:overview.allocMemory', { used: o.allocation.memoryMb, max: o.allocation.maxMemoryMb })}
                  used={o.allocation.memoryMb}
                  total={o.allocation.maxMemoryMb}
                  text={`${Math.round((o.allocation.memoryMb / Math.max(1, o.allocation.maxMemoryMb)) * 100)}%`}
                />
                <Meter
                  icon={HardDrive}
                  label={t('admin:overview.allocDisk', { used: o.allocation.diskGb, max: o.allocation.maxDiskGb })}
                  used={o.allocation.diskGb}
                  total={o.allocation.maxDiskGb}
                  text={`${Math.round((o.allocation.diskGb / Math.max(1, o.allocation.maxDiskGb)) * 100)}%`}
                />
                <p className="text-sm text-muted-foreground">
                  {t('admin:overview.ips', { free: o.allocation.ipsFree, total: o.allocation.ipsTotal })}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('admin:overview.vps')}</CardTitle>
              </CardHeader>
              <CardContent>
                {o.vps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('admin:overview.noVps')}</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm" data-testid="admin-vps-by-status">
                    {o.vps.map((v) => (
                      <li key={v.status} className="flex items-center justify-between gap-2">
                        <VpsStatusBadge status={v.status} />
                        <span className="font-medium tabular-nums">{v.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link to="/admin/vps" className="mt-3 inline-block text-sm text-link underline-offset-4 hover:underline">
                  {t('admin:vps.title')}
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('admin:overview.users')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {o.users.map((u) => (
                    <li key={u.role} className="flex items-center justify-between gap-2">
                      <span>{roleLabel(u.role, u.roleName)}</span>
                      <span className="font-medium tabular-nums">{u.count}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('admin:overview.billing')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                <p>{t('admin:overview.pending', { count: o.billing.pendingCount, amount: formatBrl(o.billing.pendingCents, locale) })}</p>
                <p className="text-muted-foreground">
                  {t('admin:overview.paid30', { amount: formatBrl(o.billing.paidLast30DaysCents, locale) })}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Card data-testid="admin-jobs">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-2">
            <CardTitle>{t('admin:overview.jobs')}</CardTitle>
            {o ? (
              <ul className="flex flex-wrap gap-2 text-xs">
                {o.jobs.map((j) => (
                  <li key={j.status} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5">
                    <span aria-hidden className={cn('size-2 rounded-full', JOB_DOT[j.status])} />
                    {jobLabel(j.status)}: <span className="font-medium tabular-nums">{j.count}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch id="admin-jobs-periodic" checked={periodic} onCheckedChange={setPeriodic} />
              <Label htmlFor="admin-jobs-periodic">{t('admin:overview.showPeriodic')}</Label>
            </div>
            <Select value={jobStatus} onValueChange={(v) => setJobStatus(v as AdminJobStatus | 'ALL')}>
              <SelectTrigger className="w-44" aria-label={t('admin:overview.jobsFilter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('admin:overview.jobsAll')}</SelectItem>
                {ADMIN_JOB_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {jobLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {jobs.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>{t('admin:overview.jobType')}</TableHead>
                  <TableHead>{t('admin:overview.jobStatus')}</TableHead>
                  <TableHead>{t('admin:overview.jobVps')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('admin:overview.jobAttempts')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('admin:overview.jobUpdated')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('admin:overview.jobError')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {t('admin:overview.jobsEmpty')}
                    </TableCell>
                  </TableRow>
                ) : null}
                {jobs.data?.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono text-muted-foreground">{j.id}</TableCell>
                    <TableCell className="font-mono">{j.type}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span aria-hidden className={cn('size-2 rounded-full', JOB_DOT[j.status])} />
                        {jobLabel(j.status)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono">{j.vps?.hostname ?? '—'}</TableCell>
                    <TableCell className="hidden tabular-nums md:table-cell">
                      {j.attempts}/{j.maxAttempts}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{formatDateTime(j.updatedAt, locale)}</TableCell>
                    <TableCell className="hidden max-w-xs truncate text-xs text-muted-foreground lg:table-cell" title={j.lastError ?? ''}>
                      {j.lastError ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
