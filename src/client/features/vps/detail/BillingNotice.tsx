import type { VpsDTO } from '@shared/types/catalog';
import { CircleAlert, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatBrl } from '@/lib/currency';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Cobrança recorrente (Fase 10): fatura de renovação ou de troca de plano em aberto, ou a VPS suspensa por falta de
 * pagamento (com o prazo antes da exclusão). A fatura da criação tem o próprio aviso na página.
 */
export function BillingNotice({ vps }: { vps: VpsDTO }) {
  const { t, i18n } = useTranslation('vps');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const invoice = vps.pendingInvoice;
  if (!invoice || invoice.kind === 'CREATION' || vps.status === 'PENDING_PAYMENT') return null;

  const amount = formatBrl(invoice.amountCents, locale);
  const suspended = vps.status === 'SUSPENDED';
  let text: string;
  if (suspended) text = t('detail.billing.suspended', { date: formatDateTime(invoice.dueAt, locale) });
  else if (invoice.kind === 'RENEWAL')
    text = t('detail.billing.renewal', { amount, date: formatDateTime(vps.paidUntil ?? invoice.dueAt, locale) });
  else text = t('detail.billing.upgrade', { amount, date: formatDateTime(invoice.dueAt, locale) });
  const Icon = suspended ? CircleAlert : Receipt;

  return (
    <Card className={cn(suspended && 'border-destructive')} data-testid="billing-notice" data-kind={suspended ? 'suspended' : invoice.kind}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-start gap-2">
          <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', suspended ? 'text-destructive' : 'text-link')} />
          <span>{text}</span>
        </p>
        <Button asChild>
          <Link to={`/checkout/${invoice.id}`}>{t('detail.payNow')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
