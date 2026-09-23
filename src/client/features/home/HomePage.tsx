import { Headset, MonitorPlay, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SystemStatus } from './SystemStatus';

const FEATURES = [
  { key: 'fast', icon: Timer },
  { key: 'console', icon: MonitorPlay },
  { key: 'support', icon: Headset },
] as const;

export function HomePage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-14">
      <section className="grid items-center gap-10 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5">
          <Badge variant="secondary" className="w-fit font-mono">
            {t('home.eyebrow')}
          </Badge>
          <h1 className="text-4xl font-extrabold leading-[1.05] sm:text-5xl" data-testid="home-title">
            {t('home.title')}
          </h1>
          <p className="max-w-prose text-lg text-muted-foreground">{t('home.subtitle')}</p>
          <div className="flex flex-wrap items-center gap-3">
            {/* A tela de planos chega na Fase 5. */}
            <Button size="lg" asChild>
              <Link to="/register">{t('home.ctaPrimary')}</Link>
            </Button>
            <Button size="lg" variant="outline" disabled>
              {t('home.ctaSecondary')}
            </Button>
            <Badge variant="outline">{t('home.comingSoon')}</Badge>
          </div>
        </div>
        <SystemStatus />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ key, icon: Icon }) => (
          <Card key={key}>
            <CardHeader>
              <Icon className="mb-2 size-6 text-link" aria-hidden />
              <CardTitle className="font-heading">{t(`home.features.${key}.title`)}</CardTitle>
              <CardDescription>{t(`home.features.${key}.description`)}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>
    </div>
  );
}
