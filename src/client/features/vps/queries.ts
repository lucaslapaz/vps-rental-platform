import type { SshKeyDTO } from '@shared/types/auth';
import type { InvoiceDTO, OsTemplateDTO, PlanDTO, VpsDTO } from '@shared/types/catalog';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

/** Queries do catálogo, das VPS e da cobrança (TanStack Query, plano §14.2). */
export const queryKeys = {
  plans: ['catalog', 'plans'] as const,
  osTemplates: ['catalog', 'os-templates'] as const,
  vpsList: ['vps'] as const,
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
    // Enquanto alguma VPS está sendo criada, atualiza sozinho (o tempo real via Socket.IO chega na Fase 6).
    refetchInterval: (q) => (q.state.data?.some((v) => v.status === 'PROVISIONING') ? 5000 : false),
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
