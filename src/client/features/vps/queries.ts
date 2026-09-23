import { BUSY_STATUSES } from '@shared/constants/vps';
import type { METRICS_TIMEFRAMES } from '@shared/schemas/vps';
import type { SshKeyDTO } from '@shared/types/auth';
import type { InvoiceDTO, OsTemplateDTO, PlanDTO, VpsDTO, VpsEventDTO, VpsLiveDTO, VpsMetricPointDTO } from '@shared/types/catalog';
import { useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '@/lib/api';

/** Queries do catálogo, das VPS e da cobrança (TanStack Query, plano §14.2). */
export const queryKeys = {
  plans: ['catalog', 'plans'] as const,
  osTemplates: ['catalog', 'os-templates'] as const,
  vpsList: ['vps'] as const,
  vps: (id: string) => ['vps', id] as const,
  vpsEvents: (id: string) => ['vps', id, 'events'] as const,
  vpsLive: (id: string) => ['vps', id, 'live'] as const,
  vpsMetrics: (id: string, timeframe: MetricsTimeframe) => ['vps', id, 'metrics', timeframe] as const,
  invoices: ['invoices'] as const,
  invoice: (id: string) => ['invoices', id] as const,
  sshKeys: ['account', 'ssh-keys'] as const,
};

export const usePlans = () =>
  useQuery({
    queryKey: queryKeys.plans,
    queryFn: () => apiGet<{ plans: PlanDTO[]; location: { node: string } }>('/plans'),
    staleTime: 5 * 60_000,
  });

export const useOsTemplates = () =>
  useQuery({
    queryKey: queryKeys.osTemplates,
    queryFn: async () => (await apiGet<{ osTemplates: OsTemplateDTO[] }>('/os-templates')).osTemplates,
    staleTime: 5 * 60_000,
  });

export const useMyVps = () =>
  useQuery({
    queryKey: queryKeys.vpsList,
    queryFn: async () => (await apiGet<{ vps: VpsDTO[] }>('/vps')).vps,
    // O normal é o Socket.IO avisar (vps:status). Enquanto há operação em andamento, uma consulta lenta cobre o caso
    // de o socket ter caído.
    refetchInterval: (q) => (q.state.data?.some((v) => BUSY_STATUSES.includes(v.status)) ? 20_000 : false),
  });

export type MetricsTimeframe = (typeof METRICS_TIMEFRAMES)[number];

/** Uma VPS (página /vps/:id). O socket invalida o prefixo ["vps"], então ela atualiza sozinha. */
export const useVps = (id: string) =>
  useQuery({
    queryKey: queryKeys.vps(id),
    queryFn: async () => (await apiGet<{ vps: VpsDTO }>(`/vps/${id}`)).vps,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 1,
  });

/** Uso ao vivo (o servidor guarda 5 s em cache); só consulta com a VPS ligada. */
export const useVpsLive = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: queryKeys.vpsLive(id),
    queryFn: async () => (await apiGet<{ live: VpsLiveDTO | null }>(`/vps/${id}/live`)).live,
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });

export const useVpsMetrics = (id: string, timeframe: MetricsTimeframe, enabled = true) =>
  useQuery({
    queryKey: queryKeys.vpsMetrics(id, timeframe),
    queryFn: async () => (await apiGet<{ points: VpsMetricPointDTO[] }>(`/vps/${id}/metrics?timeframe=${timeframe}`)).points,
    enabled,
    refetchInterval: timeframe === 'hour' ? 60_000 : false,
  });

/** Histórico da VPS (inclui as etapas da criação). O socket invalida esta query a cada vps:progress. */
export const useVpsEvents = (id: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.vpsEvents(id),
    queryFn: async () => (await apiGet<{ events: VpsEventDTO[] }>(`/vps/${id}/events`)).events,
    enabled,
  });

export const useInvoices = () =>
  useQuery({ queryKey: queryKeys.invoices, queryFn: async () => (await apiGet<{ invoices: InvoiceDTO[] }>('/invoices')).invoices });

export const useInvoice = (id: string) =>
  useQuery({ queryKey: queryKeys.invoice(id), queryFn: async () => (await apiGet<{ invoice: InvoiceDTO }>(`/invoices/${id}`)).invoice });

export const useSshKeys = (enabled = true) =>
  useQuery({ queryKey: queryKeys.sshKeys, queryFn: async () => (await apiGet<{ keys: SshKeyDTO[] }>('/account/ssh-keys')).keys, enabled });

/** "1024 MB" → "1 GB"; "512 MB" fica em MB. */
export function formatMemory(mb: number, locale: string) {
  return mb >= 1024 ? `${new Intl.NumberFormat(locale).format(mb / 1024)} GB` : `${mb} MB`;
}
