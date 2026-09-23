import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';
import { NotFoundPage } from './NotFoundPage';

/** Fronteira de erro do roteador: 404 vira a página "não encontrada"; o resto, uma tela de erro genérica. */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-3xl font-extrabold">{t('error.title')}</h1>
      <p className="text-muted-foreground">{t('error.description')}</p>
      <Button onClick={() => window.location.reload()}>{t('error.reload')}</Button>
    </div>
  );
}
