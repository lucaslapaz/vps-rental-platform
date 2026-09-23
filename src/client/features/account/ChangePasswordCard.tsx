import { zodResolver } from '@hookform/resolvers/zod';
import { type ChangePasswordInput, changePasswordSchema } from '@shared/schemas/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TextField } from '@/components/form/TextField';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { applyServerErrors } from '@/lib/forms';

export function ChangePasswordCard() {
  const { t } = useTranslation(['account', 'errors']);
  const queryClient = useQueryClient();
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const { revokedSessions } = await api<{ revokedSessions: number }>('PUT', '/account/password', values);
      toast.success(t('account:password.success', { count: revokedSessions }));
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] });
    } catch (err) {
      if (!applyServerErrors(err, form.setError, ['currentPassword', 'newPassword'])) toast.error(errorMessage(err));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">{t('account:password.title')}</CardTitle>
        <CardDescription>{t('account:password.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              label={t('account:password.current')}
              type="password"
              autoComplete="current-password"
              registration={form.register('currentPassword')}
              error={errors.currentPassword}
            />
            <TextField
              label={t('account:password.new')}
              type="password"
              autoComplete="new-password"
              registration={form.register('newPassword')}
              error={errors.newPassword}
            />
            <Button type="submit" disabled={isSubmitting} className="w-fit">
              {t('account:password.submit')}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
