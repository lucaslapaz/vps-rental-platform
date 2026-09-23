import { type CreateVpsInput, createVpsSchema } from '@shared/schemas/vps';
import type { OsTemplateDTO, PlanDTO } from '@shared/types/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, MapPin, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, type ApiErrorDetail, api } from '@/lib/api';
import { formatBrl, formatMoney, useCurrency } from '@/lib/currency';
import { errorMessage, validationMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { formatMemory, queryKeys, useOsTemplates, usePlans, useSshKeys } from './queries';

type Method = 'key' | 'password' | 'both';

const suggestHostname = (family: string) => `favo-${family}-${Math.random().toString(36).slice(2, 6)}`;

/** Força da senha (0–4): comprimento e variedade de caracteres. É só orientação; o mínimo real é 10 caracteres. */
function passwordScore(pw: string): number {
  if (!pw) return 0;
  let score = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}
const STRENGTH = ['weak', 'weak', 'fair', 'good', 'strong'] as const;

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

/** Cartão selecionável (imagem, plano, método de acesso): um radio acessível com aparência de card. */
function Choice({
  selected,
  disabled,
  onSelect,
  children,
  testId,
}: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: cartão rico (título, preço, selos) no padrão ARIA de radio, operável pelo teclado
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onSelect}
      data-testid={testId}
      className={cn(
        'relative flex w-full flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left transition-colors outline-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        selected ? 'border-primary ring-2 ring-primary/40' : 'hover:border-foreground/30',
        disabled && 'cursor-not-allowed opacity-50 hover:border-border',
      )}
    >
      {selected ? <Check className="absolute top-3 right-3 size-4 text-link" aria-hidden /> : null}
      {children}
    </button>
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
  const savedKeys = useSshKeys();

  const [templateSlug, setTemplateSlug] = useState<string>();
  const [planSlug, setPlanSlug] = useState<string>();
  const [method, setMethod] = useState<Method>('key');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [keyIds, setKeyIds] = useState<number[]>([]);
  const [newKey, setNewKey] = useState('');
  const [saveKey, setSaveKey] = useState(true);
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [sshPasswordAuth, setSshPasswordAuth] = useState(false);
  const [rootEnabled, setRootEnabled] = useState(false);
  const [rootPassword, setRootPassword] = useState('');
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
    if (!usernameTouched) setUsername(tpl.defaultUser);
    setHostname((h) => (h === '' || /^favo-[a-z]+-[a-z0-9]{4}$/.test(h) ? suggestHostname(tpl.family) : h));
    const current = plans.data?.plans.find((p) => p.slug === planSlug);
    if (!current || !meetsMinimum(current, tpl)) setPlanSlug(plans.data?.plans.find((p) => meetsMinimum(p, tpl))?.slug);
    if (tpl.requiresPassword && method === 'key') chooseMethod('both');
    if (!tpl.supportsRootPassword) setRootEnabled(false);
  };

  /** Padrão do "login SSH por senha": ligado se o método for só senha, desligado se houver chave (§14.5). */
  const chooseMethod = (m: Method) => {
    setMethod(m);
    setSshPasswordAuth(m === 'password');
  };

  // Seleção inicial, quando o catálogo chega: a primeira imagem (e o menor plano compatível com ela).
  const firstTemplate = templates.data?.[0];
  const catalogReady = Boolean(plans.data);
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda uma vez, quando o catálogo carrega
  useEffect(() => {
    if (!templateSlug && firstTemplate && catalogReady) selectTemplate(firstTemplate);
  }, [firstTemplate, catalogReady]);

  const usesKey = method !== 'password';
  const usesPassword = method !== 'key';
  const score = passwordScore(password);

  const payload = useMemo<CreateVpsInput>(
    () => ({
      osTemplate: templateSlug ?? '',
      plan: planSlug ?? '',
      hostname,
      username,
      sshKeyIds: usesKey ? keyIds : [],
      ...(usesKey && newKey.trim() ? { newSshKey: { publicKey: newKey, save: saveKey } } : {}),
      ...(usesPassword && password ? { password } : {}),
      sshPasswordAuth: usesPassword && sshPasswordAuth,
      ...(rootEnabled && rootPassword ? { rootPassword } : {}),
    }),
    [
      templateSlug,
      planSlug,
      hostname,
      username,
      usesKey,
      keyIds,
      newKey,
      saveKey,
      usesPassword,
      password,
      sshPasswordAuth,
      rootEnabled,
      rootPassword,
    ],
  );

  const onSubmit = async () => {
    const next: Record<string, string> = {};
    const parsed = createVpsSchema.safeParse(payload);
    if (!parsed.success) for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
    if (usesPassword && password !== passwordConfirm) next.passwordConfirm = 'passwordMismatch';
    if (template?.requiresPassword && !password) next.password = 'required';
    if (usesKey && keyIds.length === 0 && !newKey.trim() && !usesPassword) next.newSshKey = 'authMethodRequired';
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
            <div className="flex flex-col gap-6">
              <Field>
                <FieldLabel>{t('vps:create.auth.method')}</FieldLabel>
                <div role="radiogroup" aria-label={t('vps:create.auth.method')} className="grid gap-3 sm:grid-cols-3">
                  {(['key', 'password', 'both'] as const).map((m) => (
                    <Choice
                      key={m}
                      selected={method === m}
                      disabled={m === 'key' && template?.requiresPassword}
                      onSelect={() => chooseMethod(m)}
                      testId={`method-${m}`}
                    >
                      <span className="font-medium">
                        {t(
                          m === 'key'
                            ? 'vps:create.auth.methodKey'
                            : m === 'password'
                              ? 'vps:create.auth.methodPassword'
                              : 'vps:create.auth.methodBoth',
                        )}
                      </span>
                      {m === 'key' ? <span className="text-xs text-muted-foreground">{t('vps:create.auth.methodKeyHint')}</span> : null}
                    </Choice>
                  ))}
                </div>
                {template?.requiresPassword ? <FieldDescription>{t('vps:create.auth.passwordRequired')}</FieldDescription> : null}
                {err('password') && !usesPassword ? <FieldError>{err('password')}</FieldError> : null}
              </Field>

              <Field data-invalid={Boolean(err('username')) || undefined} className="max-w-sm">
                <FieldLabel htmlFor="vps-username">{t('vps:create.auth.username')}</FieldLabel>
                <Input
                  id="vps-username"
                  className="font-mono"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value.toLowerCase());
                    setUsernameTouched(true);
                  }}
                  aria-invalid={Boolean(err('username')) || undefined}
                />
                {err('username') ? (
                  <FieldError>{err('username')}</FieldError>
                ) : (
                  <FieldDescription>{t('vps:create.auth.usernameHint', { sudo: template?.sudoCommand ?? 'sudo' })}</FieldDescription>
                )}
              </Field>

              {usesKey ? (
                <div className="flex flex-col gap-4">
                  <Field>
                    <FieldLabel>{t('vps:create.auth.savedKeys')}</FieldLabel>
                    {savedKeys.data?.length ? (
                      <div className="flex flex-col gap-2">
                        {savedKeys.data.map((k) => (
                          <label key={k.id} className="flex items-center gap-3 rounded-lg border p-3 text-sm" htmlFor={`key-${k.id}`}>
                            <Checkbox
                              id={`key-${k.id}`}
                              checked={keyIds.includes(k.id)}
                              onCheckedChange={(c) => setKeyIds((ids) => (c ? [...ids, k.id] : ids.filter((i) => i !== k.id)))}
                            />
                            <KeyRound className="size-4 text-link" aria-hidden />
                            <span className="font-medium">{k.name}</span>
                            <span className="truncate font-mono text-xs text-muted-foreground">{k.fingerprint}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <FieldDescription>{t('vps:create.auth.noSavedKeys')}</FieldDescription>
                    )}
                  </Field>
                  <Field data-invalid={Boolean(err('newSshKey.publicKey') || err('newSshKey')) || undefined}>
                    <FieldLabel htmlFor="vps-newkey">{t('vps:create.auth.newKey')}</FieldLabel>
                    <Textarea
                      id="vps-newkey"
                      rows={3}
                      spellCheck={false}
                      className="font-mono text-xs"
                      placeholder={t('vps:create.auth.newKeyPlaceholder')}
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                    />
                    {err('newSshKey.publicKey') || err('newSshKey') ? (
                      <FieldError>{err('newSshKey.publicKey') ?? err('newSshKey')}</FieldError>
                    ) : null}
                    {newKey.trim() ? (
                      <label className="flex items-center gap-2 text-sm" htmlFor="vps-savekey">
                        <Checkbox id="vps-savekey" checked={saveKey} onCheckedChange={(c) => setSaveKey(c === true)} />
                        {t('vps:create.auth.saveKey')}
                      </label>
                    ) : null}
                  </Field>
                </div>
              ) : null}

              {usesPassword ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field data-invalid={Boolean(err('password')) || undefined}>
                    <FieldLabel htmlFor="vps-password">{t('vps:create.auth.password')}</FieldLabel>
                    <Input
                      id="vps-password"
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    {err('password') ? <FieldError>{err('password')}</FieldError> : null}
                    <div className="flex items-center gap-2" aria-live="polite">
                      <Progress value={(score / 4) * 100} className="h-1.5" aria-label={t('vps:create.auth.strength.label')} />
                      <span className="w-20 text-right text-xs text-muted-foreground">
                        {password ? t(`vps:create.auth.strength.${STRENGTH[score] ?? 'weak'}`) : ''}
                      </span>
                    </div>
                  </Field>
                  <Field data-invalid={Boolean(err('passwordConfirm')) || undefined}>
                    <FieldLabel htmlFor="vps-password2">{t('vps:create.auth.passwordConfirm')}</FieldLabel>
                    <Input
                      id="vps-password2"
                      type="password"
                      autoComplete="new-password"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                    />
                    {err('passwordConfirm') ? <FieldError>{err('passwordConfirm')}</FieldError> : null}
                  </Field>
                  <label className="flex items-start gap-3 sm:col-span-2" htmlFor="vps-sshpass">
                    <Switch id="vps-sshpass" checked={sshPasswordAuth} onCheckedChange={setSshPasswordAuth} />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{t('vps:create.auth.sshPasswordAuth')}</span>
                      <span className="text-xs text-muted-foreground">{t('vps:create.auth.sshPasswordAuthHint')}</span>
                    </span>
                  </label>
                </div>
              ) : null}

              {template?.supportsRootPassword ? (
                <div className="flex flex-col gap-3">
                  <label className="flex items-start gap-3" htmlFor="vps-root">
                    <Switch id="vps-root" checked={rootEnabled} onCheckedChange={setRootEnabled} />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium">{t('vps:create.auth.rootPassword')}</span>
                      <span className="text-xs text-muted-foreground">{t('vps:create.auth.rootPasswordHint')}</span>
                    </span>
                  </label>
                  {rootEnabled ? (
                    <Field data-invalid={Boolean(err('rootPassword')) || undefined} className="max-w-sm">
                      <FieldLabel htmlFor="vps-rootpw">{t('vps:create.auth.rootPasswordField')}</FieldLabel>
                      <Input
                        id="vps-rootpw"
                        type="password"
                        autoComplete="new-password"
                        value={rootPassword}
                        onChange={(e) => setRootPassword(e.target.value)}
                      />
                      {err('rootPassword') ? <FieldError>{err('rootPassword')}</FieldError> : null}
                    </Field>
                  ) : null}
                </div>
              ) : null}
            </div>
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
