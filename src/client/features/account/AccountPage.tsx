import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, useCan } from '@/features/auth/useAuth';
import { roleLabel } from '@/lib/errors';
import { ChangePasswordCard } from './ChangePasswordCard';
import { SessionsCard } from './SessionsCard';
import { SshKeysCard } from './SshKeysCard';

export function AccountPage() {
  const { t } = useTranslation(['account', 'common']);
  const { user } = useAuth();
  const canManageKeys = useCan('sshkey:manage:own');
  if (!user) return null;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-extrabold">{t('account:title')}</h1>
        <p className="text-muted-foreground">{t('account:subtitle')}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-heading">{t('account:profile.title')}</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('account:profile.name')}</dt>
              <dd>{user.name}</dd>
              <dt className="text-muted-foreground">{t('account:profile.email')}</dt>
              <dd className="font-mono">{user.email}</dd>
              <dt className="text-muted-foreground">{t('account:profile.role')}</dt>
              <dd data-testid="account-role">{roleLabel(user.role)}</dd>
            </dl>
          </CardContent>
        </Card>
        <ChangePasswordCard />
      </div>

      <SessionsCard />
      {canManageKeys ? <SshKeysCard /> : null}
    </div>
  );
}
