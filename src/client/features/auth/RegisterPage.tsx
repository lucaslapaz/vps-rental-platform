import { zodResolver } from '@hookform/resolvers/zod';
import { type RegisterInput, registerSchema } from '@shared/schemas/auth';
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

export function RegisterPage() {
  const { t } = useTranslation(['auth', 'common']);
  const [params] = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterInput>({ resolver: zodResolver(registerSchema), defaultValues: { name: '', email: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api<{ user: PublicUser }>('POST', '/auth/register', values);
      window.location.assign(safeNext(params.get('next')));
    } catch (err) {
      if (!applyServerErrors(err, form.setError, ['name', 'email', 'password'])) setFormError(errorMessage(err));
    }
  });

  return (
    <AuthCard
      title={t('auth:register.title')}
      subtitle={t('auth:register.subtitle')}
      footer={
        <>
          {t('auth:register.hasAccount')}{' '}
          <Link to="/login" className="text-link underline-offset-4 hover:underline">
            {t('auth:register.loginLink')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate data-testid="register-form">
        <FieldGroup>
          <TextField label={t('auth:register.name')} autoComplete="name" registration={form.register('name')} error={errors.name} />
          <TextField
            label={t('auth:register.email')}
            type="email"
            autoComplete="email"
            registration={form.register('email')}
            error={errors.email}
          />
          <TextField
            label={t('auth:register.password')}
            type="password"
            autoComplete="new-password"
            description={t('auth:register.passwordHint')}
            registration={form.register('password')}
            error={errors.password}
          />
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? t('auth:register.submitting') : t('auth:register.submit')}
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
