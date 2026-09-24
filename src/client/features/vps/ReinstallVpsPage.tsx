import { canRun } from '@shared/constants/vps';
import { type ReinstallVpsInput, reinstallVpsSchema } from '@shared/schemas/vps';
import type { OsTemplateDTO } from '@shared/types/catalog';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, type ApiErrorDetail, api } from '@/lib/api';
import { errorMessage, validationMessage } from '@/lib/errors';
import { AccessFields, useAccessForm } from './AccessFields';
import { Choice } from './Choice';
import { formatMemory, queryKeys, useOsTemplates, useVps } from './queries';

/**
 * Reinstalar (plano §17, Fase 10): escolher a imagem e o acesso de novo, como na criação. O disco é apagado; IP,
 * hostname, plano e período pago continuam. Confirmação digitando o hostname.
 */
export function ReinstallVpsPage() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation(['vps', 'errors']);
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const vps = useVps(id);
  const templates = useOsTemplates();
  const access = useAccessForm();
  const [templateSlug, setTemplateSlug] = useState<string>();
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const v = vps.data;
  const template = templates.data?.find((x) => x.slug === templateSlug);
  const fits = (tpl: OsTemplateDTO) => Boolean(v) && (v?.memoryMb ?? 0) >= tpl.minMemoryMb && (v?.diskGb ?? 0) >= tpl.minDiskGb;
  const selectTemplate = (tpl: OsTemplateDTO) => {
    setTemplateSlug(tpl.slug);
    access.applyTemplate(tpl);
  };

  // Começa com a imagem e o usuário atuais da VPS (o usuário fica mesmo se o cliente trocar de imagem).
  const current = templates.data?.find((x) => x.slug === v?.osTemplate.slug);
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda uma vez, quando a VPS e o catálogo chegam
  useEffect(() => {
    if (!templateSlug && current && v) {
      selectTemplate(current);
      access.setUsername(v.username);
    }
  }, [current]);

  const payload = useMemo<ReinstallVpsInput>(
    () => ({ osTemplate: templateSlug ?? '', confirmHostname: confirm.trim(), ...access.values }),
    [templateSlug, confirm, access.values],
  );

  if (vps.isPending || templates.isPending) return <Skeleton className="h-96 w-full" />;
  if (!v) return <p className="text-muted-foreground">{t('vps:detail.notFound')}</p>;

  const back = (
    <Link to={`/vps/${v.id}?tab=settings`} className="inline-flex w-fit items-center gap-1 text-sm text-link hover:underline">
      <ArrowLeft className="size-4" aria-hidden />
      {t('vps:reinstall.back', { hostname: v.hostname })}
    </Link>
  );
  if (!canRun('reinstall', v.status)) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-muted-foreground">{t('vps:reinstall.notAllowed')}</p>
      </div>
    );
  }

  const onSubmit = async () => {
    const next: Record<string, string> = {};
    const parsed = reinstallVpsSchema.safeParse(payload);
    if (!parsed.success) for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
    Object.assign(next, access.localErrors(template));
    if (payload.confirmHostname !== v.hostname) next.confirmHostname = 'confirmHostname';
    setErrors(next);
    if (Object.keys(next).length) {
      toast.error(t('errors:VALIDATION_ERROR'));
      return;
    }
    setSubmitting(true);
    try {
      await api('POST', `/vps/${v.id}/reinstall`, payload);
      await queryClient.invalidateQueries({ queryKey: queryKeys.vps(v.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.sshKeys });
      toast.success(t('vps:reinstall.started', { hostname: v.hostname }));
      navigate(`/vps/${v.id}`);
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        setErrors(Object.fromEntries((err.details as ApiErrorDetail[]).map((d) => [d.path, d.message])));
      }
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="reinstall-page">
      {back}
      <header>
        <h1 className="text-3xl font-extrabold">{t('vps:reinstall.title', { hostname: v.hostname })}</h1>
        <p className="text-muted-foreground">{t('vps:reinstall.subtitle')}</p>
      </header>

      <Card className="border-destructive/40">
        <CardContent className="flex items-start gap-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">{t('vps:reinstall.warning')}</p>
            <p className="text-muted-foreground">{t('vps:reinstall.kept', { ip: v.ip ?? '—', plan: v.plan.name })}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">{t('vps:create.image.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label={t('vps:create.image.title')} className="grid gap-3 sm:grid-cols-2">
            {templates.data?.map((tpl) => (
              <Choice
                key={tpl.slug}
                selected={tpl.slug === templateSlug}
                disabled={!fits(tpl)}
                onSelect={() => selectTemplate(tpl)}
                testId={`image-${tpl.slug}`}
              >
                <span className="font-heading font-semibold">{tpl.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t('vps:create.image.minimum', { memory: formatMemory(tpl.minMemoryMb, locale), disk: tpl.minDiskGb })}
                </span>
                {!fits(tpl) ? (
                  <span className="mt-1 text-xs text-destructive">{t('vps:reinstall.belowPlan', { plan: v.plan.name })}</span>
                ) : null}
              </Choice>
            ))}
          </div>
          {errors.osTemplate ? <p className="mt-2 text-sm text-destructive">{validationMessage(errors.osTemplate)}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">{t('vps:create.auth.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AccessFields form={access} template={template} errors={errors} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">{t('vps:reinstall.confirmTitle')}</CardTitle>
          <CardDescription>{t('vps:reinstall.confirmHint', { hostname: v.hostname })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field data-invalid={Boolean(errors.confirmHostname) || undefined} className="max-w-md">
            <FieldLabel htmlFor="reinstall-confirm">{t('vps:detail.danger.confirmLabel')}</FieldLabel>
            <Input
              id="reinstall-confirm"
              className="font-mono"
              value={confirm}
              autoComplete="off"
              placeholder={v.hostname}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {errors.confirmHostname ? (
              <FieldError>{validationMessage(errors.confirmHostname)}</FieldError>
            ) : (
              <FieldDescription>{t('vps:reinstall.confirmHelp')}</FieldDescription>
            )}
          </Field>
          <Button
            variant="destructive"
            className="w-fit"
            disabled={submitting || !template || confirm.trim() !== v.hostname}
            onClick={() => void onSubmit()}
            data-testid="reinstall-submit"
          >
            {submitting ? t('vps:reinstall.submitting') : t('vps:reinstall.submit')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
