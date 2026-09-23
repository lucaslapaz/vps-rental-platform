import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { useCan } from '@/features/auth/useAuth';
import { useRealtime } from '@/features/realtime/useRealtime';
import { cn } from '@/lib/utils';
import { CurrencyMenu } from './CurrencyMenu';
import { LanguageMenu } from './LanguageMenu';
import { ThemeMenu } from './ThemeMenu';
import { UserMenu } from './UserMenu';

function NavItem({ to, children }: { to: string; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
          isActive && 'bg-muted text-foreground',
        )
      }
    >
      {children}
    </NavLink>
  );
}

/** Layout base: cabeçalho (marca, navegação por permissão, idioma, tema, usuário), conteúdo e rodapé. */
export function AppLayout() {
  const { t } = useTranslation();
  const canVps = useCan('vps:read:own');
  const canAdmin = useCan('admin:users:read');
  const canBilling = useCan('billing:read:own');
  useRealtime();

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        {t('nav.skipToContent')}
      </a>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-6">
            <Link to="/" aria-label={t('nav.home')} className="rounded-md focus-visible:outline-2">
              <Logo />
            </Link>
            <nav className="hidden items-center gap-1 sm:flex" aria-label={t('nav.home')}>
              {canVps ? <NavItem to="/vps">{t('nav.vps')}</NavItem> : null}
              {canBilling ? <NavItem to="/billing">{t('nav.billing')}</NavItem> : null}
              {canAdmin ? <NavItem to="/admin/users">{t('nav.admin')}</NavItem> : null}
            </nav>
          </div>
          <div className="flex items-center gap-1">
            <LanguageMenu />
            <CurrencyMenu />
            <ThemeMenu />
            <UserMenu />
          </div>
        </div>
      </header>

      <main id="conteudo" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        <Outlet />
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>{t('brand.tagline')}</span>
          <span data-testid="fictional-notice">{t('brand.fictional')}</span>
        </div>
      </footer>
    </div>
  );
}
