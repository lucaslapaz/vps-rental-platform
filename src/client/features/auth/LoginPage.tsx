import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginSchema } from '@shared/schemas/auth';
import type { PublicUser } from '@shared/types/auth';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { TextField } from '@/components/form/TextField';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { applyServerErrors } from '@/lib/forms';
import { AuthCard } from './AuthCard';
import { safeNext } from './guards';

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api<{ user: PublicUser }>('POST', '/auth/login', values);
      // Recarrega o app do zero já com os cookies novos (fluxo do plano §9.6).
      window.location.assign(safeNext(params.get('next')));
    } catch (err) {
      if (!applyServerErrors(err, form.setError, ['email', 'password'])) setFormError(errorMessage(err));
    }
  });

  return (
    <AuthCard
      title={t('auth:login.title')}
      subtitle={t('auth:login.subtitle')}
      footer={
        <>
          {t('auth:login.noAccount')}{' '}
          <Link
            to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next') as string)}` : ''}`}
            className="text-link underline-offset-4 hover:underline"
          >
            {t('auth:login.registerLink')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate data-testid="login-form">
        <FieldGroup>
          <TextField
            label={t('auth:login.email')}
            type="email"
            autoComplete="email"
            registration={form.register('email')}
            error={errors.email}
          />
          <TextField
            label={t('auth:login.password')}
            type="password"
            autoComplete="current-password"
            registration={form.register('password')}
            error={errors.password}
          />
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? t('auth:login.submitting') : t('auth:login.submit')}
          </Button>
        </FieldGroup>
      </form>
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{t('auth:login.demoHint')}</p>
    </AuthCard>
  );
}
