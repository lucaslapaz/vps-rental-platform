import { useTranslation } from 'react-i18next';
import { LogoMark } from './Logo';

/** Indicador de carregamento: uma célula pulsando (plano §14.6). */
export function HexLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className={fullScreen ? 'grid min-h-svh place-items-center' : 'grid place-items-center py-12'}>
      <LogoMark className="size-12 animate-pulse motion-reduce:animate-none" />
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}
