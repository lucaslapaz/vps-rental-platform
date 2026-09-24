import type { AdminVpsDTO } from '@shared/types/admin';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VpsStatusBadge } from '@/components/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiGet } from '@/lib/api';
import { AdminNav } from './AdminNav';

/** Administração → Todas as VPS (plano §17, Fase 10): somente leitura, sem console nem ações. */
export function AdminVpsPage() {
  const { t, i18n } = useTranslation(['admin', 'billing']);
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const query = useDeferredValue(search.trim());
  const vps = useQuery({
    queryKey: ['admin', 'vps', query, includeDeleted],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (query) params.set('query', query);
      if (includeDeleted) params.set('includeDeleted', 'true');
      const qs = params.toString();
      return (await apiGet<{ vps: AdminVpsDTO[] }>(`/admin/vps${qs ? `?${qs}` : ''}`)).vps;
    },
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'short' });

  return (
    <div className="flex flex-col gap-6">
      <AdminNav />
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold">{t('admin:vps.title')}</h1>
          <p className="max-w-2xl text-muted-foreground">{t('admin:vps.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="admin-vps-deleted" checked={includeDeleted} onCheckedChange={setIncludeDeleted} />
            <Label htmlFor="admin-vps-deleted">{t('admin:vps.includeDeleted')}</Label>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              aria-label={t('admin:vps.searchLabel')}
              placeholder={t('admin:vps.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
      </header>

      <Card>
        <CardContent>
          {vps.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table data-testid="admin-vps-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:vps.hostname')}</TableHead>
                  <TableHead>{t('admin:vps.status')}</TableHead>
                  <TableHead>{t('admin:vps.owner')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('admin:vps.plan')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('admin:vps.ip')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('admin:vps.vmid')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('admin:vps.paidUntil')}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t('admin:vps.createdAt')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vps.data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      {t('admin:vps.empty')}
                    </TableCell>
                  </TableRow>
                ) : null}
                {vps.data?.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <span className="font-mono">{v.hostname}</span>
                      <span className="block text-xs text-muted-foreground">{v.osTemplate}</span>
                    </TableCell>
                    <TableCell>
                      <VpsStatusBadge status={v.status} />
                      {v.pendingInvoiceKind ? (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t('admin:vps.pendingInvoice')}: {t(`billing:kind.${v.pendingInvoiceKind}`)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="block">{v.owner.name}</span>
                      <span className="block text-xs text-muted-foreground">{v.owner.email}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {v.plan}
                      <span className="block text-xs text-muted-foreground">
                        {v.memoryMb} MB · {v.diskGb} GB
                      </span>
                    </TableCell>
                    <TableCell className="hidden font-mono md:table-cell">{v.ip ?? '—'}</TableCell>
                    <TableCell className="hidden font-mono lg:table-cell">{v.pveVmid ?? '—'}</TableCell>
                    <TableCell className="hidden lg:table-cell">{v.paidUntil ? date.format(new Date(v.paidUntil)) : '—'}</TableCell>
                    <TableCell className="hidden text-muted-foreground xl:table-cell">{date.format(new Date(v.createdAt))}</TableCell>
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
