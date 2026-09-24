import type { InvoiceKindDTO } from '@shared/types/catalog';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { InvoiceStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useInvoices } from '@/features/vps/queries';
import { formatBrl, formatMoney, useCurrency } from '@/lib/currency';

/** Faturas (`/billing`): valores em BRL e, se escolhida outra moeda, a conversão aproximada ao lado. */
export function BillingPage() {
  const { t, i18n } = useTranslation(['billing', 'common']);
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const { currency } = useCurrency();
  const invoices = useInvoices();
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'short' });
  const kindLabel: Record<InvoiceKindDTO, string> = {
    CREATION: t('billing:kind.CREATION'),
    RENEWAL: t('billing:kind.RENEWAL'),
    UPGRADE: t('billing:kind.UPGRADE'),
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold">{t('billing:list.title')}</h1>
        <p className="text-muted-foreground">{t('billing:list.subtitle')}</p>
      </header>
      <Card>
        <CardContent>
          {invoices.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <Table data-testid="invoices-table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('billing:list.number')}</TableHead>
                  <TableHead>{t('billing:list.description')}</TableHead>
                  <TableHead className="text-right">{t('billing:list.amount')}</TableHead>
                  <TableHead>{t('billing:list.status')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('billing:list.due')}</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.data?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {t('billing:list.empty')}
                    </TableCell>
                  </TableRow>
                ) : null}
                {invoices.data?.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono">{inv.number}</TableCell>
                    <TableCell className="max-w-xs">
                      <span className="block truncate" title={inv.description}>
                        {inv.description}
                      </span>
                      <span className="block text-xs text-muted-foreground" data-testid="invoice-kind">
                        {kindLabel[inv.kind]}
                        {inv.periodStart && inv.periodEnd
                          ? ` · ${t('billing:list.period', { start: dateFmt.format(new Date(inv.periodStart)), end: dateFmt.format(new Date(inv.periodEnd)) })}`
                          : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium">{formatBrl(inv.amountCents, locale)}</span>
                      {currency !== 'BRL' ? (
                        <span className="block text-xs text-muted-foreground">{formatMoney(inv.amountCents, currency, locale)}</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{dateFmt.format(new Date(inv.dueAt))}</TableCell>
                    <TableCell>
                      {inv.status === 'PENDING' ? (
                        <Button asChild size="sm">
                          <Link to={`/checkout/${inv.id}`}>{t('billing:list.pay')}</Link>
                        </Button>
                      ) : null}
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
