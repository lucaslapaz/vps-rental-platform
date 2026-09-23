import { zodResolver } from '@hookform/resolvers/zod';
import { type PayInvoiceInput, payInvoiceSchema } from '@shared/schemas/vps';
import type { InvoiceDTO } from '@shared/types/catalog';
import { cardBrand, TEST_CARDS } from '@shared/utils/card';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CreditCard, FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { TextField } from '@/components/form/TextField';
import { InvoiceStatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { queryKeys, useInvoice } from '@/features/vps/queries';
import { ApiError, api } from '@/lib/api';
import { formatBrl, formatMoney, useCurrency } from '@/lib/currency';
import { errorMessage } from '@/lib/errors';
import { applyServerErrors } from '@/lib/forms';

const nextYear = String((new Date().getFullYear() + 3) % 100).padStart(2, '0');

/** Checkout do pagamento simulado (plano §12): o valor em BRL em destaque; o convertido só como referência. */
export function CheckoutPage() {
  const { invoiceId = '' } = useParams();
  const { t, i18n } = useTranslation(['billing', 'common', 'errors']);
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const { currency } = useCurrency();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invoice = useInvoice(invoiceId);
  const [declined, setDeclined] = useState<string | null>(null);
  const form = useForm<PayInvoiceInput>({
    resolver: zodResolver(payInvoiceSchema),
    defaultValues: { cardNumber: '', holder: '', expMonth: '12' as unknown as number, expYear: nextYear as unknown as number, cvc: '' },
  });
  const { errors, isSubmitting } = form.formState;

  if (invoice.isPending) return <Skeleton className="h-96 w-full" />;
  if (!invoice.data) return <p className="text-destructive">{errorMessage(invoice.error)}</p>;
  const inv: InvoiceDTO = invoice.data;
  const brl = formatBrl(inv.amountCents, locale);

  const onSubmit = form.handleSubmit(async (values) => {
    setDeclined(null);
    try {
      await api('POST', `/invoices/${inv.id}/pay`, values);
      toast.success(t('billing:checkout.success'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.invoices }),
        queryClient.invalidateQueries({ queryKey: queryKeys.vpsList }),
      ]);
      navigate('/vps');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PAYMENT_DECLINED') {
        const failure =
          (err.details as { failureCode?: string } | undefined)?.failureCode === 'insufficient_funds'
            ? 'insufficient_funds'
            : 'card_declined';
        setDeclined(t(`billing:checkout.declined.${failure}`));
        await queryClient.invalidateQueries({ queryKey: queryKeys.invoice(inv.id) });
      } else if (!applyServerErrors(err, form.setError, ['cardNumber', 'holder', 'expMonth', 'expYear', 'cvc'])) {
        toast.error(errorMessage(err));
      }
    }
  });

  if (inv.status !== 'PENDING') {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <CardHeader className="items-center">
          {inv.status === 'PAID' ? <CircleCheck className="mx-auto size-12 text-status-running" aria-hidden /> : null}
          <CardTitle className="font-heading text-2xl">
            {inv.status === 'PAID' ? t('billing:checkout.paidTitle') : t('billing:checkout.notPayable')}
          </CardTitle>
          {inv.status === 'PAID' ? <CardDescription>{t('billing:checkout.paidDescription')}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex justify-center gap-2">
          <Button asChild>
            <Link to="/vps">{t('billing:checkout.goToVps')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/billing">{t('billing:checkout.goToBilling')}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const fillTestCard = (number: string) => {
    form.setValue('cardNumber', number, { shouldValidate: true });
    if (!form.getValues('holder')) form.setValue('holder', 'Cliente Favo');
    if (!form.getValues('cvc')) form.setValue('cvc', '123');
  };

  const typedBrand = cardBrand(form.watch('cardNumber') ?? '');

  return (
    <div className="mx-auto grid max-w-5xl items-start gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-xl">
            <CreditCard className="size-5 text-link" aria-hidden />
            {t('billing:checkout.card.title')}
          </CardTitle>
          <CardDescription>{t('billing:checkout.demo')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate data-testid="checkout-form">
            <FieldGroup>
              <TextField
                label={t('billing:checkout.card.number')}
                inputMode="numeric"
                autoComplete="cc-number"
                className="font-mono"
                registration={form.register('cardNumber')}
                error={errors.cardNumber}
                description={typedBrand !== 'unknown' ? typedBrand.toUpperCase() : undefined}
              />
              <TextField
                label={t('billing:checkout.card.holder')}
                autoComplete="cc-name"
                registration={form.register('holder')}
                error={errors.holder}
              />
              <div className="grid grid-cols-3 gap-3">
                <TextField
                  label={t('billing:checkout.card.expMonth')}
                  inputMode="numeric"
                  placeholder="MM"
                  autoComplete="cc-exp-month"
                  registration={form.register('expMonth')}
                  error={errors.expMonth}
                />
                <TextField
                  label={t('billing:checkout.card.expYear')}
                  inputMode="numeric"
                  placeholder="AA"
                  autoComplete="cc-exp-year"
                  registration={form.register('expYear')}
                  error={errors.expYear}
                />
                <TextField
                  label={t('billing:checkout.card.cvc')}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  registration={form.register('cvc')}
                  error={errors.cvc}
                />
              </div>
              {declined ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="declined">
                  {declined}
                </p>
              ) : null}
              <Button type="submit" size="lg" disabled={isSubmitting} data-testid="pay">
                {isSubmitting ? t('billing:checkout.card.submitting') : t('billing:checkout.card.submit', { value: brl })}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        <Card data-testid="checkout-summary">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardDescription>{t('billing:checkout.invoice', { number: inv.number })}</CardDescription>
              <InvoiceStatusBadge status={inv.status} />
            </div>
            <CardTitle className="font-heading text-lg leading-snug">{inv.description}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">{t('billing:checkout.total')}</p>
            <p className="font-heading text-4xl font-extrabold" data-testid="checkout-brl">
              {brl}
            </p>
            {currency !== 'BRL' ? (
              <p className="text-sm text-muted-foreground" data-testid="checkout-converted">
                {t('billing:checkout.converted', { value: formatMoney(inv.amountCents, currency, locale) })}
              </p>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {t('billing:checkout.due', {
                date: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(inv.dueAt)),
              })}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="test-cards">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-heading text-base">
              <FlaskConical className="size-4 text-link" aria-hidden />
              {t('billing:checkout.testCards.title')}
            </CardTitle>
            <CardDescription>{t('billing:checkout.testCards.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {TEST_CARDS.map((c) => (
              <div key={c.number} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                <div>
                  <p className="font-mono">{c.number}</p>
                  <p className="text-xs text-muted-foreground">{t(`billing:checkout.testCards.${c.outcome}`)}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fillTestCard(c.number)}
                  data-card={c.number.replaceAll(' ', '')}
                >
                  {t('billing:checkout.testCards.use')}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
