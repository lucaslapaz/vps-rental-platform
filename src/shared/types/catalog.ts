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
