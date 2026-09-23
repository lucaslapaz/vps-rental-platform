import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { LanguageMenu } from './LanguageMenu';
import { ThemeMenu } from './ThemeMenu';

/** Layout base: cabeçalho (marca, idioma, tema), conteúdo e rodapé com o aviso de marca fictícia. */
export function AppLayout() {
  const { t } = useTranslation();

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
          <Link to="/" aria-label={t('nav.home')} className="rounded-md focus-visible:outline-2">
            <Logo />
          </Link>
          <div className="flex items-center gap-1">
            <LanguageMenu />
            <ThemeMenu />
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
