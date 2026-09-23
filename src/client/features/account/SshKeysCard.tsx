import { zodResolver } from '@hookform/resolvers/zod';
import { type SshKeyInput, sshKeySchema } from '@shared/schemas/account';
import type { SshKeyDTO } from '@shared/types/auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { api, apiGet } from '@/lib/api';
import { errorMessage, validationMessage } from '@/lib/errors';
import { applyServerErrors } from '@/lib/forms';

const KEYS = ['account', 'ssh-keys'] as const;

export function SshKeysCard() {
  const { t } = useTranslation(['account', 'common', 'errors']);
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: KEYS, queryFn: () => apiGet<{ keys: SshKeyDTO[] }>('/account/ssh-keys') });
  const form = useForm<SshKeyInput>({ resolver: zodResolver(sshKeySchema), defaultValues: { name: '', publicKey: '' } });
  const { errors, isSubmitting } = form.formState;

  const remove = useMutation({
    mutationFn: (id: number) => api('DELETE', `/account/ssh-keys/${id}`),
    onSuccess: async () => {
      toast.success(t('account:sshKeys.removed'));
      await queryClient.invalidateQueries({ queryKey: KEYS });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await api('POST', '/account/ssh-keys', values);
      toast.success(t('account:sshKeys.added'));
      form.reset();
      await queryClient.invalidateQueries({ queryKey: KEYS });
    } catch (err) {
      if (!applyServerErrors(err, form.setError, ['name', 'publicKey'])) toast.error(errorMessage(err));
    }
  });

  const publicKeyError = validationMessage(errors.publicKey?.message);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">{t('account:sshKeys.title')}</CardTitle>
        <CardDescription>{t('account:sshKeys.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-2" data-testid="ssh-keys-list">
          {keys.isPending ? <Skeleton className="h-16 w-full" /> : null}
          {keys.data?.keys.length === 0 ? <p className="text-sm text-muted-foreground">{t('account:sshKeys.empty')}</p> : null}
          {keys.data?.keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-lg border p-3">
              <KeyRound className="size-5 shrink-0 text-link" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{k.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground" title={k.fingerprint}>
                  {k.type} · {k.fingerprint}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm">
                    {t('account:sshKeys.delete')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('account:sshKeys.confirmTitle', { name: k.name })}</AlertDialogTitle>
                    <AlertDialogDescription>{t('account:sshKeys.confirmDescription')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => remove.mutate(k.id)}>
                      {t('account:sshKeys.delete')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>

        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              label={t('account:sshKeys.name')}
              placeholder={t('account:sshKeys.namePlaceholder')}
              registration={form.register('name')}
              error={errors.name}
            />
            <Field data-invalid={Boolean(errors.publicKey) || undefined}>
              <FieldLabel htmlFor="campo-publicKey">{t('account:sshKeys.publicKey')}</FieldLabel>
              <textarea
                id="campo-publicKey"
                rows={4}
                spellCheck={false}
                aria-invalid={Boolean(errors.publicKey) || undefined}
                placeholder="ssh-ed25519 AAAA… voce@computador"
                className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                {...form.register('publicKey')}
              />
              {publicKeyError ? (
                <FieldError>{publicKeyError}</FieldError>
              ) : (
                <FieldDescription>{t('account:sshKeys.publicKeyHint')}</FieldDescription>
              )}
            </Field>
            <Button type="submit" disabled={isSubmitting} className="w-fit">
              {t('account:sshKeys.add')}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
