import { zodResolver } from '@hookform/resolvers/zod';
import { vpsPasswordSchema } from '@shared/schemas/vps';
import type { VpsDTO } from '@shared/types/catalog';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { TextField } from '@/components/form/TextField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { validationMessage } from '@/lib/errors';
import { applyServerErrors } from '@/lib/forms';
import { useSshKeys } from '../queries';
import { useVpsCommand } from './useVpsCommand';

const passwordForm = vpsPasswordSchema
  .extend({ confirm: z.string() })
  .refine((v) => v.password === v.confirm, { error: 'passwordMismatch', path: ['confirm'] });
type PasswordForm = z.input<typeof passwordForm>;

function PasswordCard({ vps, disabled }: { vps: VpsDTO; disabled: boolean }) {
  const { t } = useTranslation('vps');
  const form = useForm<PasswordForm>({ resolver: zodResolver(passwordForm), defaultValues: { target: 'user', password: '', confirm: '' } });
  const command = useVpsCommand<{ target: 'user' | 'root'; password: string }>(
    vps.id,
    (body) => ({ method: 'POST', path: `/vps/${vps.id}/access/password`, body }),
    {
      success: () => t('detail.access.passwordChanged'),
      onError: (err) => applyServerErrors(err, form.setError, ['password', 'target']),
    },
  );
  const onSubmit = form.handleSubmit(async ({ target, password }) => {
    try {
      await command.mutateAsync({ target, password });
      form.reset({ target, password: '', confirm: '' });
    } catch {
      // o toast/erro do campo já foi mostrado pelo useVpsCommand
    }
  });
  const { errors } = form.formState;

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>{t('detail.access.passwordTitle')}</CardTitle>
          <CardDescription>{t('detail.access.passwordDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel>{t('detail.access.target')}</FieldLabel>
              <Controller
                control={form.control}
                name="target"
                render={({ field }) => (
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="flex flex-wrap gap-4">
                    <Label className="flex items-center gap-2 font-normal">
                      <RadioGroupItem value="user" />
                      {t('detail.access.targetUser', { username: vps.username })}
                    </Label>
                    <Label className="flex items-center gap-2 font-normal">
                      <RadioGroupItem value="root" />
                      {t('detail.access.targetRoot')}
                    </Label>
                  </RadioGroup>
                )}
              />
            </Field>
            <TextField
              label={t('detail.access.newPassword')}
              type="password"
              autoComplete="new-password"
              registration={form.register('password')}
              error={errors.password}
            />
            <TextField
              label={t('detail.access.confirmPassword')}
              type="password"
              autoComplete="new-password"
              registration={form.register('confirm')}
              error={errors.confirm}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-4">
          <Button type="submit" disabled={disabled || command.isPending}>
            {t('detail.access.savePassword')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function SshPasswordCard({ vps, disabled }: { vps: VpsDTO; disabled: boolean }) {
  const { t } = useTranslation('vps');
  const command = useVpsCommand<boolean>(
    vps.id,
    (enabled) => ({ method: 'POST', path: `/vps/${vps.id}/access/ssh-password-auth`, body: { enabled } }),
    {
      success: () => t('detail.access.sshChanged'),
    },
  );
  const value = command.isPending ? Boolean(command.variables) : vps.sshPasswordAuth;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('detail.access.sshTitle')}</CardTitle>
        <CardDescription>{t('detail.access.sshDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Label className="flex items-center gap-3 font-normal">
          <Switch checked={value} onCheckedChange={(enabled) => command.mutate(enabled)} disabled={disabled || command.isPending} />
          {value ? t('detail.overview.sshPasswordOn') : t('detail.overview.sshPasswordOff')}
        </Label>
        <p className="text-xs text-muted-foreground">{t('detail.access.sshHintNoPassword')}</p>
      </CardContent>
    </Card>
  );
}

function AddKeyCard({ vps, disabled }: { vps: VpsDTO; disabled: boolean }) {
  const { t } = useTranslation('vps');
  const keys = useSshKeys();
  const [sshKeyId, setSshKeyId] = useState<string>('');
  const [publicKey, setPublicKey] = useState('');
  const [save, setSave] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const command = useVpsCommand<{ sshKeyId?: number; publicKey?: string; save?: boolean }>(
    vps.id,
    (body) => ({ method: 'POST', path: `/vps/${vps.id}/access/ssh-keys`, body }),
    {
      success: () => t('detail.access.keyAdded'),
      onError: (err) => {
        // 422 SSH_KEY_INVALID e 400 de validação ficam no campo; o resto vira toast.
        if (err instanceof ApiError && err.code === 'SSH_KEY_INVALID') {
          setFieldError('sshKeyFormat');
          return true;
        }
        return applyServerErrors(err, (_name, e) => setFieldError(e.message), ['publicKey', 'sshKeyId']);
      },
    },
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldError(undefined);
    const body = sshKeyId ? { sshKeyId: Number(sshKeyId) } : { publicKey: publicKey.trim(), save };
    try {
      await command.mutateAsync(body);
      setSshKeyId('');
      setPublicKey('');
      setSave(false);
    } catch {
      // erro já exibido
    }
  };
  const message = validationMessage(fieldError);

  return (
    <Card className="lg:col-span-2">
      <form onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle>{t('detail.access.keysTitle')}</CardTitle>
          <CardDescription>{t('detail.access.keysDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {keys.data?.length ? (
              <Field>
                <FieldLabel htmlFor="chave-salva">{t('detail.access.savedKey')}</FieldLabel>
                <Select value={sshKeyId} onValueChange={(v) => setSshKeyId(v)}>
                  <SelectTrigger id="chave-salva" className="w-full max-w-md">
                    <SelectValue placeholder={t('detail.access.chooseKey')} />
                  </SelectTrigger>
                  <SelectContent>
                    {keys.data.map((k) => (
                      <SelectItem key={k.id} value={String(k.id)}>
                        {k.name} · <span className="font-mono text-xs">{k.fingerprint.slice(0, 20)}…</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            <Field data-invalid={Boolean(message) || undefined}>
              <FieldLabel htmlFor="chave-nova">{t('detail.access.orPaste')}</FieldLabel>
              <Textarea
                id="chave-nova"
                rows={3}
                className="font-mono text-xs"
                placeholder={t('create.auth.newKeyPlaceholder')}
                value={publicKey}
                disabled={Boolean(sshKeyId)}
                onChange={(e) => setPublicKey(e.target.value)}
                aria-invalid={Boolean(message) || undefined}
              />
              {message ? <FieldError>{message}</FieldError> : null}
              {!sshKeyId ? (
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox checked={save} onCheckedChange={(v) => setSave(v === true)} />
                  {t('detail.access.saveKey')}
                </Label>
              ) : (
                <FieldDescription />
              )}
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-4">
          <Button type="submit" disabled={disabled || command.isPending || (!sshKeyId && !publicKey.trim())}>
            {t('detail.access.addKey')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

/** Aba Acesso (plano §10.6): mudanças feitas dentro da VM pelo guest agent, sem reiniciar. Exige a VPS ligada. */
export function AccessTab({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  const disabled = vps.status !== 'RUNNING';
  return (
    <div className="flex flex-col gap-4">
      {disabled ? <p className="rounded-lg border bg-muted/50 p-3 text-sm">{t('detail.access.notRunning')}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <PasswordCard vps={vps} disabled={disabled} />
        <SshPasswordCard vps={vps} disabled={disabled} />
        <AddKeyCard vps={vps} disabled={disabled} />
      </div>
    </div>
  );
}
