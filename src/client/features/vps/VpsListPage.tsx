import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LogoMark } from '@/components/brand/Logo';
import { VpsStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/features/auth/useAuth';
import { formatMemory, useMyVps } from './queries';

/** Lista de VPS (§14.1). A página de cada VPS (abas, console, ações) chega na Fase 7. */
export function VpsListPage() {
  const { t, i18n } = useTranslation(['vps', 'common']);
  const vps = useMyVps();
  const canCreate = useCan('vps:create');

  const createButton = canCreate ? (
    <Button asChild>
      <Link to="/vps/new" data-testid="create-vps">
        <Plus />
        {t('vps:list.create')}
      </Link>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="vps-list">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-extrabold">{t('vps:list.title')}</h1>
        {vps.data?.length ? createButton : null}
      </header>

      {vps.isPending ? <Skeleton className="h-32 w-full" /> : null}

      {vps.data?.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <LogoMark className="size-14 opacity-60" />
          <h2 className="text-xl font-bold">{t('vps:list.emptyTitle')}</h2>
          <p className="text-muted-foreground">{t('vps:list.emptyDescription')}</p>
          {createButton}
        </div>
      ) : null}

      {vps.data?.length ? (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('vps:list.columns.hostname')}</TableHead>
                  <TableHead>{t('vps:list.columns.image')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('vps:list.columns.plan')}</TableHead>
                  <TableHead>{t('vps:list.columns.ip')}</TableHead>
                  <TableHead>{t('vps:list.columns.status')}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vps.data.map((v) => (
                  <TableRow key={v.id} data-hostname={v.hostname}>
                    <TableCell className="font-mono font-medium">{v.hostname}</TableCell>
                    <TableCell>{v.osTemplate.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {v.plan.name} · {formatMemory(v.memoryMb, i18n.resolvedLanguage ?? 'pt-BR')}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {v.ip ?? <span className="text-muted-foreground">{t('vps:list.ipPending')}</span>}
                    </TableCell>
                    <TableCell>
                      <VpsStatusBadge status={v.status} />
                    </TableCell>
                    <TableCell>
                      {v.status === 'PENDING_PAYMENT' && v.pendingInvoiceId ? (
                        <Button asChild size="sm">
                          <Link to={`/checkout/${v.pendingInvoiceId}`}>{t('vps:list.pay')}</Link>
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
