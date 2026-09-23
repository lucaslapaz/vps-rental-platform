import { useTranslation } from 'react-i18next';
import { LogoMark } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Lista de VPS (§14.1). Nesta fase só o estado vazio; a lista e a criação chegam nas fases 5 a 7. */
export function VpsListPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-8" data-testid="vps-list">
      <h1 className="text-3xl font-extrabold">{t('vps.title')}</h1>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
        <LogoMark className="size-14 opacity-60" />
        <h2 className="text-xl font-bold">{t('vps.emptyTitle')}</h2>
        <p className="text-muted-foreground">{t('vps.emptyDescription')}</p>
        <div className="flex items-center gap-2">
          <Button disabled>{t('vps.create')}</Button>
          <Badge variant="outline">{t('home.comingSoon')}</Badge>
        </div>
      </div>
    </div>
  );
}
