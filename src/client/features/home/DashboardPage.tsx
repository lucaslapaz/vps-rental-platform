import { Headset, Server, ShieldCheck, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAdminLinks } from '@/features/admin/AdminNav';
import { useAuth, useCan } from '@/features/auth/useAuth';

function Tile({ icon, title, description, to, cta }: { icon: ReactNode; title: string; description: string; to?: string; cta?: string }) {
  return (
    <Card>
      <CardHeader>
        <div className="mb-2 text-link">{icon}</div>
        <CardTitle className="font-heading">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {to && cta ? (
        <CardFooter>
          <Button asChild variant="outline" size="sm">
            <Link to={to}>{cta}</Link>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** Painel do usuário logado (rota `/`, plano §14.1): os cartões dependem das permissões, não do nome da role. */
export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canVps = useCan('vps:read:own');
  /** Primeira página de administração que o usuário pode ver (visão geral, VPS, usuários ou roles). */
  const adminHome = useAdminLinks()[0]?.to;
  const canQueue = useCan('support:queue:read');
  if (!user) return null;

  return (
    <div className="flex flex-col gap-8" data-testid="dashboard">
      <header>
        <h1 className="text-3xl font-extrabold">{t('dashboard.greeting', { name: user.name.split(' ')[0] })}</h1>
        <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {canVps ? (
          <Tile
            icon={<Server />}
            title={t('dashboard.vps.title')}
            description={t('dashboard.vps.description')}
            to="/vps"
            cta={t('dashboard.vps.cta')}
          />
        ) : null}
        {canQueue ? (
          <Card>
            <CardHeader>
              <div className="mb-2 text-link">
                <Headset />
              </div>
              <CardTitle className="font-heading">{t('dashboard.support.title')}</CardTitle>
              <CardDescription>{t('dashboard.support.description')}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Badge variant="outline">{t('home.comingSoon')}</Badge>
            </CardFooter>
          </Card>
        ) : null}
        {adminHome ? (
          <Tile
            icon={<ShieldCheck />}
            title={t('dashboard.admin.title')}
            description={t('dashboard.admin.description')}
            to={adminHome}
            cta={t('dashboard.admin.cta')}
          />
        ) : null}
        <Tile
          icon={<UserRound />}
          title={t('dashboard.account.title')}
          description={t('dashboard.account.description')}
          to="/account"
          cta={t('dashboard.account.cta')}
        />
      </div>
    </div>
  );
}
