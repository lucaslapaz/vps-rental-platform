import { type CreateVpsInput, createVpsSchema } from '@shared/schemas/vps';
import type { OsTemplateDTO, PlanDTO } from '@shared/types/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, type ApiErrorDetail, api } from '@/lib/api';
import { formatBrl, formatMoney, useCurrency } from '@/lib/currency';
import { errorMessage, validationMessage } from '@/lib/errors';
import { AccessFields, useAccessForm } from './AccessFields';
import { Choice } from './Choice';
import { formatMemory, queryKeys, useOsTemplates, usePlans } from './queries';

const suggestHostname = (family: string) => `favo-${family}-${Math.random().toString(36).slice(2, 6)}`;

const meetsMinimum = (plan: PlanDTO, tpl: OsTemplateDTO) => plan.memoryMb >= tpl.minMemoryMb && plan.diskGb >= tpl.minDiskGb;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Tela de criação no estilo DigitalOcean/Vultr/Hetzner (plano §14.5): página única, resumo fixo ao lado. */
export function CreateVpsPage() {
  const { t, i18n } = useTranslation(['vps', 'common', 'errors']);
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const { currency } = useCurrency();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const plans = usePlans();
  const templates = useOsTemplates();

  const [templateSlug, setTemplateSlug] = useState<string>();
  const [planSlug, setPlanSlug] = useState<string>();
  const access = useAccessForm();
  const [hostname, setHostname] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const template = templates.data?.find((x) => x.slug === templateSlug);
  const plan = plans.data?.plans.find((p) => p.slug === planSlug);

  /**
   * Trocar de imagem ajusta o resto da tela (campos condicionais, §14.5): usuário padrão (se o cliente não mexeu),
   * hostname sugerido, menor plano compatível, métodos de acesso e senha root.
   */
  const selectTemplate = (tpl: OsTemplateDTO) => {
    setTemplateSlug(tpl.slug);
    access.applyTemplate(tpl);
    setHostname((h) => (h === '' || /^favo-[a-z]+-[a-z0-9]{4}$/.test(h) ? suggestHostname(tpl.family) : h));
    const current = plans.data?.plans.find((p) => p.slug === planSlug);
    if (!current || !meetsMinimum(current, tpl)) setPlanSlug(plans.data?.plans.find((p) => meetsMinimum(p, tpl))?.slug);
  };

  // Seleção inicial, quando o catálogo chega: a primeira imagem (e o menor plano compatível com ela).
  const firstTemplate = templates.data?.[0];
  const catalogReady = Boolean(plans.data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda uma vez, quando o catálogo carrega
  useEffect(() => {
    if (!templateSlug && firstTemplate && catalogReady) selectTemplate(firstTemplate);
  }, [firstTemplate, catalogReady]);

  const payload = useMemo<CreateVpsInput>(
    () => ({ osTemplate: templateSlug ?? '', plan: planSlug ?? '', hostname, ...access.values }),
    [templateSlug, planSlug, hostname, access.values],
  );

  const onSubmit = async () => {
    const next: Record<string, string> = {};
    const parsed = createVpsSchema.safeParse(payload);
    if (!parsed.success) for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
    Object.assign(next, access.localErrors(template));
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error(t('errors:VALIDATION_ERROR'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<{ invoice: { id: string } }>('POST', '/vps', payload);
      await queryClient.invalidateQueries({ queryKey: queryKeys.vpsList });
      await queryClient.invalidateQueries({ queryKey: queryKeys.sshKeys });
      navigate(`/checkout/${res.invoice.id}`);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(Object.fromEntries((err.details as ApiErrorDetail[]).map((d) => [d.path, d.message])));
      }
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const err = (path: string) => validationMessage(errors[path]);

  if (plans.isPending || templates.isPending) return <Skeleton className="h-96 w-full" />;

  const imageBadges = (tpl: OsTemplateDTO) =>
    [
      tpl.family === 'alpine' && !tpl.hasGui ? t('vps:create.image.light') : null,
      tpl.family === 'ubuntu' ? t('vps:create.image.popular') : null,
      tpl.hasGui ? t('vps:create.image.gui') : null,
    ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-extrabold">{t('vps:create.title')}</h1>
        <p className="text-muted-foreground">{t('vps:create.subtitle')}</p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Section title={t('vps:create.location.title')}>
            <div className="flex w-fit items-center gap-3 rounded-xl border border-primary p-4 ring-2 ring-primary/40">
              <MapPin className="size-5 text-link" aria-hidden />
              <div>
                <p className="font-medium">{t('vps:create.location.lab')}</p>
                <p className="text-sm text-muted-foreground">{t('vps:create.location.node', { node: plans.data?.location.node ?? '' })}</p>
              </div>
            </div>
          </Section>

          <Section title={t('vps:create.image.title')}>
            <div role="radiogroup" aria-label={t('vps:create.image.title')} className="grid gap-3 sm:grid-cols-2">
              {templates.data?.map((tpl) => (
                <Choice
                  key={tpl.slug}
                  selected={tpl.slug === templateSlug}
                  onSelect={() => selectTemplate(tpl)}
                  testId={`image-${tpl.slug}`}
                >
                  <span className="font-heading font-semibold">{tpl.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('vps:create.image.minimum', { memory: formatMemory(tpl.minMemoryMb, locale), disk: tpl.minDiskGb })}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {imageBadges(tpl).map((b) => (
                      <Badge key={b} variant="secondary">
                        {b}
                      </Badge>
                    ))}
                  </span>
                </Choice>
              ))}
            </div>
          </Section>

          <Section title={t('vps:create.plan.title')}>
            <div role="radiogroup" aria-label={t('vps:create.plan.title')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {plans.data?.plans.map((p) => {
                const ok = template ? meetsMinimum(p, template) : true;
                return (
                  <Choice
                    key={p.slug}
                    selected={p.slug === planSlug}
                    disabled={!ok}
                    onSelect={() => setPlanSlug(p.slug)}
                    testId={`plan-${p.slug}`}
                  >
                    <span className="font-heading font-semibold">{p.name}</span>
                    <span className="text-lg font-bold" data-testid={`price-${p.slug}`}>
                      {formatMoney(p.priceCents, currency, locale)}
                      <span className="text-xs font-normal text-muted-foreground">{t('vps:create.plan.perMonth')}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('vps:create.plan.vcpu', { count: p.cores })} ·{' '}
                      {t('vps:create.plan.ram', { value: formatMemory(p.memoryMb, locale) })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t('vps:create.plan.disk', { value: p.diskGb })} · {t('vps:create.plan.bandwidth', { value: p.bandwidthMbps })}
                    </span>
                    {!ok && template ? (
                      <span className="mt-1 text-xs text-destructive" data-testid={`plan-reason-${p.slug}`}>
                        {t('vps:create.plan.belowMinimum', {
                          image: template.name,
                          memory: formatMemory(template.minMemoryMb, locale),
                          disk: template.minDiskGb,
                        })}
                      </span>
                    ) : null}
                  </Choice>
                );
              })}
            </div>
          </Section>

          <Section title={t('vps:create.auth.title')}>
            <AccessFields form={access} template={template} errors={errors} />
          </Section>

          <Section title={t('vps:create.details.title')}>
            <Field data-invalid={Boolean(err('hostname')) || undefined} className="max-w-md">
              <FieldLabel htmlFor="vps-hostname">{t('vps:create.details.hostname')}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="vps-hostname"
                  className="font-mono"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value.toLowerCase())}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t('vps:create.details.suggest')}
                  onClick={() => setHostname(suggestHostname(template?.family ?? 'vps'))}
                >
                  <RefreshCw />
                </Button>
              </div>
              {err('hostname') ? (
                <FieldError>{err('hostname')}</FieldError>
              ) : (
                <FieldDescription>{t('vps:create.details.hostnameHint')}</FieldDescription>
              )}
            </Field>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-20" data-testid="order-summary">
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-lg">{t('vps:create.summary.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                <dt className="text-muted-foreground">{t('vps:create.summary.image')}</dt>
                <dd className="text-right">{template?.name ?? '—'}</dd>
                <dt className="text-muted-foreground">{t('vps:create.summary.plan')}</dt>
                <dd className="text-right">{plan?.name ?? '—'}</dd>
              </dl>
              {plan ? (
                <div className="border-t pt-4">
                  <p className="text-muted-foreground">{t('vps:create.summary.monthly')}</p>
                  <p className="font-heading text-3xl font-extrabold" data-testid="summary-price">
                    {formatMoney(plan.priceCents, currency, locale)}
                  </p>
                  {currency !== 'BRL' ? (
                    <p className="text-xs text-muted-foreground">
                      {t('vps:create.summary.chargedInBrl', { value: formatBrl(plan.priceCents, locale) })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Button size="lg" disabled={!plan || !template || submitting} onClick={() => void onSubmit()} data-testid="submit-order">
                {submitting ? t('vps:create.summary.submitting') : plan ? t('vps:create.summary.submit') : t('vps:create.summary.choose')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('vps:create.summary.demo')}</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
