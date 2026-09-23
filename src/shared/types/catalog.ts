/** DTOs públicos do catálogo, das VPS e da cobrança. Valores em centavos de BRL (a conversão é só na tela, §14.4). */

export interface PlanDTO {
  slug: string;
  name: string;
  cores: number;
  memoryMb: number;
  diskGb: number;
  bandwidthMbps: number;
  priceCents: number;
}

export interface OsTemplateDTO {
  slug: string;
  name: string;
  family: string;
  version: string;
  defaultUser: string;
  sudoCommand: string;
  minMemoryMb: number;
  minDiskGb: number;
  supportsRootPassword: boolean;
  supportsSshKeys: boolean;
  requiresPassword: boolean;
  hasGui: boolean;
}

export type VpsStatusDTO =
  | 'PENDING_PAYMENT'
  | 'PROVISIONING'
  | 'RUNNING'
  | 'STOPPED'
  | 'STARTING'
  | 'STOPPING'
  | 'REBOOTING'
  | 'UPDATING'
  | 'DELETING'
  | 'DELETED'
  | 'SUSPENDED'
  | 'ERROR';

/** GET /api/vps/:id/live: estado ao vivo da VM (cache de 5 s no servidor). */
export interface VpsLiveDTO {
  power: 'running' | 'stopped' | 'paused' | 'unknown';
  uptimeSeconds: number;
  /** Fração 0..1 do total de vCPUs. */
  cpu: number;
  cpus: number;
  memUsedBytes: number;
  memMaxBytes: number;
  /** Uso da raiz visto de dentro da VM (guest agent); null se o agente não respondeu. */
  disk: { usedBytes: number; totalBytes: number } | null;
  diskMaxBytes: number;
  /** Alterações de CPU/RAM que só valem depois de reiniciar pelo painel (plano §10.4). */
  pendingReboot: boolean;
}

/** GET /api/vps/:id/metrics: pontos do rrddata do Proxmox (cache de 30 s). */
export interface VpsMetricPointDTO {
  time: number;
  cpu: number | null;
  memUsed: number | null;
  memMax: number | null;
  netIn: number | null;
  netOut: number | null;
}

/** Item do histórico da VPS. Nas etapas da criação: action "provision", status "progress" e a etapa em message. */
export interface VpsEventDTO {
  id: number;
  action: string;
  status: string;
  message: string | null;
  createdAt: string;
}

export interface VpsDTO {
  id: string;
  hostname: string;
  username: string;
  status: VpsStatusDTO;
  plan: { slug: string; name: string };
  osTemplate: { slug: string; name: string; family: string; sudoCommand: string; hasGui: boolean };
  cores: number;
  memoryMb: number;
  diskGb: number;
  bandwidthMbps: number;
  ip: string | null;
  sshPasswordAuth: boolean;
  rootPasswordSet: boolean;
  lastError: string | null;
  createdAt: string;
  /** Fatura em aberto (ex.: a da criação, enquanto não for paga). */
  pendingInvoiceId: string | null;
}

export type InvoiceStatusDTO = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED';

export interface PaymentDTO {
  id: string;
  status: 'APPROVED' | 'DECLINED';
  cardBrand: string;
  cardLast4: string;
  failureCode: string | null;
  createdAt: string;
}

export interface InvoiceDTO {
  id: string;
  number: number;
  description: string;
  amountCents: number;
  currency: 'BRL';
  status: InvoiceStatusDTO;
  dueAt: string;
  paidAt: string | null;
  createdAt: string;
  vps: { id: string; hostname: string; status: VpsStatusDTO } | null;
  payments: PaymentDTO[];
}
