import { zodResolver } from '@hookform/resolvers/zod';
import { canRun } from '@shared/constants/vps';
import { renameVpsSchema } from '@shared/schemas/vps';
import type { PlanDTO, VpsDTO } from '@shared/types/catalog';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { TextField } from '@/components/form/TextField';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useCan } from '@/features/auth/useAuth';
import { formatMoney, useCurrency } from '@/lib/currency';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/utils';
import { formatMemory, useOsTemplates, usePlans } from '../queries';
import { useVpsCommand } from './useVpsCommand';

type RenameForm = z.input<typeof renameVpsSchema>;

function RenameCard({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  const form = useForm<RenameForm>({ resolver: zodResolver(renameVpsSchema), values: { hostname: vps.hostname } });
  const command = useVpsCommand<string>(vps.id, (hostname) => ({ method: 'PATCH', path: `/vps/${vps.id}`, body: { hostname } }), {
    success: () => t('detail.settings.renamed'),
    onError: (err) => applyServerErrors(err, form.setError, ['hostname']),
  });
  const onSubmit = form.handleSubmit(({ hostname }) => command.mutate(hostname));
  const running = vps.status === 'RUNNING';

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>{t('detail.settings.renameTitle')}</CardTitle>
          <CardDescription>{t('detail.settings.renameDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <TextField
            label={t('create.details.hostname')}
            registration={form.register('hostname')}
            error={form.formState.errors.hostname}
            className="font-mono"
            description={running ? t('create.details.hostnameHint') : t('detail.access.notRunning')}
          />
        </CardContent>
        <CardFooter className="mt-4">
          <Button type="submit" disabled={!running || command.isPending || !form.formState.isDirty}>
            {t('detail.settings.rename')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function ResizeCard({ vps }: { vps: VpsDTO }) {
  const { t, i18n } = useTranslation('vps');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const { currency } = useCurrency();
  const plans = usePlans();
  const templates = useOsTemplates();
  const [choice, setChoice] = useState<PlanDTO | null>(null);
  const command = useVpsCommand<string>(vps.id, (plan) => ({ method: 'POST', path: `/vps/${vps.id}/resize`, body: { plan } }), {
    success: () => t('detail.settings.resizeRequested'),
  });
  const template = templates.data?.find((tpl) => tpl.slug === vps.osTemplate.slug);
  const current = plans.data?.plans.find((p) => p.slug === vps.plan.slug);
  const allowed = canRun('resize', vps.status);

  const reason = (p: PlanDTO) => {
    if (p.diskGb < vps.diskGb) return t('detail.settings.diskSmaller');
    if (template && (p.memoryMb < template.minMemoryMb || p.diskGb < template.minDiskGb)) return t('detail.settings.belowImage');
    return null;
  };
  const diff = choice && current ? choice.priceCents - current.priceCents : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.settings.resizeTitle')}</CardTitle>
        <CardDescription>{t('detail.settings.resizeDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!allowed ? <p className="text-sm text-muted-foreground">{t('detail.settings.notAvailable')}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.data?.plans.map((p) => {
            const isCurrent = p.slug === vps.plan.slug;
            const blocked = reason(p);
            return (
              <button
                key={p.slug}
                type="button"
                disabled={isCurrent || Boolean(blocked) || !allowed || command.isPending}
                onClick={() => setChoice(p)}
                data-plan={p.slug}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-left text-sm transition-colors',
                  'enabled:hover:border-primary enabled:hover:bg-accent/40 disabled:opacity-60',
                  isCurrent && 'border-primary bg-accent/40 disabled:opacity-100',
                )}
              >
                <span className="flex items-center justify-between font-semibold">
                  {p.name}
                  {isCurrent ? (
                    <span className="inline-flex items-center gap-1 text-xs font-normal">
                      <Check className="size-3" />
                      {t('detail.settings.current')}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {t('create.plan.vcpu', { count: p.cores })} · {formatMemory(p.memoryMb, locale)} · {p.diskGb} GB
                </span>
                <span className="font-medium">
                  {formatMoney(p.priceCents, currency, locale)}
                  {t('create.plan.perMonth')}
                </span>
                {blocked && !isCurrent ? <span className="text-xs text-muted-foreground">{blocked}</span> : null}
              </button>
            );
          })}
        </div>
      </CardContent>

      <AlertDialog open={choice !== null} onOpenChange={(open) => !open && setChoice(null)}>
        <AlertDialogContent>
          {choice ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t('detail.settings.resizeConfirmTitle', { hostname: vps.hostname, plan: choice.name })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {diff > 0
                    ? t('detail.settings.resizeConfirmBody', { amount: formatMoney(diff, currency, locale) })
                    : t('detail.settings.resizeNoCharge')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('detail.actions.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    command.mutate(choice.slug);
                    setChoice(null);
                  }}
                >
                  {t('detail.settings.resize', { plan: choice.name })}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Reinstalar (Fase 10): leva à página com imagem, acesso e confirmação. */
function ReinstallCard({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>{t('detail.settings.reinstallTitle')}</CardTitle>
        <CardDescription>{t('detail.settings.reinstallDescription')}</CardDescription>
      </CardHeader>
      <CardFooter>
        {canRun('reinstall', vps.status) ? (
          <Button asChild variant="outline" data-testid="reinstall-vps">
            <Link to={`/vps/${vps.id}/reinstall`}>{t('detail.settings.reinstallButton')}</Link>
          </Button>
        ) : (
          <Button variant="outline" disabled>
            {t('detail.settings.reinstallButton')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function DangerZone({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const command = useVpsCommand(vps.id, () => ({ method: 'DELETE', path: `/vps/${vps.id}` }), {
    success: () => t('detail.danger.deleted', { hostname: vps.hostname }),
  });
  const allowed = canRun('delete', vps.status) || vps.status === 'PENDING_PAYMENT';

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">{t('detail.danger.title')}</CardTitle>
        <CardDescription>{t('detail.danger.description')}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="destructive" onClick={() => setOpen(true)} disabled={!allowed || command.isPending} data-testid="delete-vps">
          {t('detail.danger.delete')}
        </Button>
      </CardFooter>
      <AlertDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setTyped('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('detail.danger.confirmTitle', { hostname: vps.hostname })}</AlertDialogTitle>
            <AlertDialogDescription>{t('detail.danger.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="confirmar-hostname">{t('detail.danger.confirmLabel')}</FieldLabel>
            <Input
              id="confirmar-hostname"
              className="font-mono"
              value={typed}
              autoComplete="off"
              placeholder={vps.hostname}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('detail.actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={typed.trim() !== vps.hostname}
              onClick={async () => {
                try {
                  await command.mutateAsync();
                  navigate('/vps');
                } catch {
                  // o toast com o motivo já foi mostrado
                }
              }}
            >
              {t('detail.danger.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Aba Configurações (plano §14.5): renomear, trocar de plano e a zona de perigo. */
export function SettingsTab({ vps }: { vps: VpsDTO }) {
  const canManage = useCan('vps:manage:own');
  const canDelete = useCan('vps:delete:own');
  return (
    <div className="flex flex-col gap-4">
      {canManage ? <RenameCard vps={vps} /> : null}
      {canManage ? <ResizeCard vps={vps} /> : null}
      {canManage && canDelete ? <ReinstallCard vps={vps} /> : null}
      {canDelete ? <DangerZone vps={vps} /> : null}
    </div>
  );
}
