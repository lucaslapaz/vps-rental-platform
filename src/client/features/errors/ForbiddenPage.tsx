import { ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function ForbiddenPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center" data-testid="forbidden">
      <ShieldX className="size-12 text-muted-foreground" aria-hidden />
      <p className="font-mono text-sm text-muted-foreground">403</p>
      <h1 className="text-3xl font-extrabold">{t('forbidden.title')}</h1>
      <p className="text-muted-foreground">{t('forbidden.description')}</p>
      <Button asChild variant="outline">
        <Link to="/">{t('forbidden.back')}</Link>
      </Button>
    </div>
  );
}
