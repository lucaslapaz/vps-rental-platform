import { METRICS_TIMEFRAMES } from '@shared/schemas/vps';
import type { VpsDTO, VpsMetricPointDTO } from '@shared/types/catalog';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatBytes, formatPercent } from '@/lib/format';
import { type MetricsTimeframe, useVpsMetrics } from '../queries';

/** Rótulo do eixo X: hora na última hora/dia; dia/mês na semana. */
function timeLabel(time: number, timeframe: MetricsTimeframe, locale: string) {
  const options: Intl.DateTimeFormatOptions =
    timeframe === 'week' ? { day: '2-digit', month: '2-digit', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
  return new Intl.DateTimeFormat(locale, options).format(new Date(time * 1000));
}

function MetricChart({
  title,
  data,
  config,
  keys,
  format,
  axisFormat = format,
  timeframe,
  locale,
}: {
  title: string;
  data: Record<string, number | null>[];
  config: ChartConfig;
  keys: string[];
  format: (v: number) => string;
  /** Formato curto só para o eixo Y (sem unidade por segundo), para os rótulos não quebrarem. */
  axisFormat?: (v: number) => string;
  timeframe: MetricsTimeframe;
  locale: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <AreaChart data={data} margin={{ left: 8, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="time"
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tickFormatter={(v: number) => timeLabel(v, timeframe, locale)}
            />
            <YAxis tickLine={false} axisLine={false} width={72} tickFormatter={(v: number) => axisFormat(v)} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) => timeLabel(Number(payload?.[0]?.payload?.time ?? 0), timeframe, locale)}
                  formatter={(value, name) => (
                    <span className="flex w-full justify-between gap-3">
                      <span className="text-muted-foreground">{config[String(name)]?.label}</span>
                      <span className="font-mono tabular-nums">{format(Number(value))}</span>
                    </span>
                  )}
                />
              }
            />
            {keys.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
            {keys.map((key) => (
              <Area
                key={key}
                dataKey={key}
                type="monotone"
                stroke={`var(--color-${key})`}
                fill={`var(--color-${key})`}
                fillOpacity={0.15}
                strokeWidth={2}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/** Aba Métricas (plano §14.5): CPU, memória e rede a partir do rrddata do Proxmox (cache de 30 s no servidor). */
export function MetricsTab({ vps }: { vps: VpsDTO }) {
  const { t, i18n } = useTranslation('vps');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const [timeframe, setTimeframe] = useState<MetricsTimeframe>('hour');
  const metrics = useVpsMetrics(vps.id, timeframe);
  const points: VpsMetricPointDTO[] = metrics.data ?? [];
  const hasData = points.some((p) => p.cpu !== null || p.memUsed !== null);

  const cpu = points.map((p) => ({ time: p.time, cpu: p.cpu }));
  const memory = points.map((p) => ({ time: p.time, memUsed: p.memUsed }));
  const network = points.map((p) => ({ time: p.time, netIn: p.netIn, netOut: p.netOut }));

  return (
    <div className="flex flex-col gap-4" data-testid="metrics">
      <Tabs value={timeframe} onValueChange={(v) => setTimeframe(v as MetricsTimeframe)}>
        <TabsList>
          {METRICS_TIMEFRAMES.map((tf) => (
            <TabsTrigger key={tf} value={tf}>
              {t(`detail.metrics.timeframe.${tf}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {metrics.isPending ? (
        <Skeleton className="h-56 w-full" />
      ) : !hasData ? (
        <p className="text-muted-foreground">{t('detail.metrics.empty')}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MetricChart
            title={t('detail.metrics.cpu')}
            data={cpu}
            keys={['cpu']}
            config={{ cpu: { label: t('detail.metrics.cpu'), color: 'var(--chart-1)' } }}
            format={(v) => formatPercent(v, locale)}
            timeframe={timeframe}
            locale={locale}
          />
          <MetricChart
            title={t('detail.metrics.memory')}
            data={memory}
            keys={['memUsed']}
            config={{ memUsed: { label: t('detail.metrics.used'), color: 'var(--chart-3)' } }}
            format={(v) => formatBytes(v, locale, 0)}
            timeframe={timeframe}
            locale={locale}
          />
          <div className="lg:col-span-2">
            <MetricChart
              title={t('detail.metrics.network')}
              data={network}
              keys={['netIn', 'netOut']}
              config={{
                netIn: { label: t('detail.metrics.in'), color: 'var(--chart-2)' },
                netOut: { label: t('detail.metrics.out'), color: 'var(--chart-4)' },
              }}
              format={(v) => t('detail.metrics.perSecond', { value: formatBytes(v, locale) })}
              axisFormat={(v) => formatBytes(v, locale, 0)}
              timeframe={timeframe}
              locale={locale}
            />
          </div>
        </div>
      )}
    </div>
  );
}
