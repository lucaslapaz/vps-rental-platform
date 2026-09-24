import type { InvoiceKindDTO, VpsStatusDTO } from './catalog.ts';

/** GET /api/admin/overview (plano §17, Fase 10): capacidade do nó, contagens e a fila de jobs. */
export interface AdminOverviewDTO {
  /** null quando o Proxmox não respondeu (o resto da visão geral continua). */
  node: {
    name: string;
    pveVersion: string;
    cpuCount: number;
    memTotalBytes: number;
    memAvailableBytes: number;
    storageTotalBytes: number;
    storageAvailBytes: number;
  } | null;
  /** Reservado pelas VPS no banco × tetos configurados (CAPACITY_MAX_*). */
  allocation: { memoryMb: number; diskGb: number; maxMemoryMb: number; maxDiskGb: number; ipsFree: number; ipsTotal: number };
  users: { role: string; roleName: string; count: number }[];
  vps: { status: VpsStatusDTO; count: number }[];
  billing: { pendingCount: number; pendingCents: number; paidLast30DaysCents: number };
  jobs: { status: AdminJobStatus; count: number }[];
}

export type AdminJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/** GET /api/admin/jobs: nunca inclui o payload (pode ter segredos cifrados). */
export interface AdminJobDTO {
  id: number;
  type: string;
  status: AdminJobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  updatedAt: string;
  lastError: string | null;
  vps: { id: string; hostname: string } | null;
}

/** GET /api/admin/vps: todas as VPS, somente leitura (sem console nem ações). */
export interface AdminVpsDTO {
  id: string;
  hostname: string;
  status: VpsStatusDTO;
  owner: { id: string; name: string; email: string };
  plan: string;
  osTemplate: string;
  memoryMb: number;
  diskGb: number;
  ip: string | null;
  pveVmid: number | null;
  paidUntil: string | null;
  lastError: string | null;
  createdAt: string;
  pendingInvoiceKind: InvoiceKindDTO | null;
}
