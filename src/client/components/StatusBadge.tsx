import type { InvoiceStatusDTO, VpsStatusDTO } from '@shared/types/catalog';
import type { ConversationStatusDTO } from '@shared/types/support';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type Tone = 'running' | 'pending' | 'stopped' | 'error' | 'suspended';

const VPS_TONE: Record<VpsStatusDTO, Tone> = {
  PENDING_PAYMENT: 'pending',
  PROVISIONING: 'pending',
  RUNNING: 'running',
  STOPPED: 'stopped',
  STARTING: 'pending',
  STOPPING: 'pending',
  REBOOTING: 'pending',
  UPDATING: 'pending',
  DELETING: 'pending',
  DELETED: 'stopped',
  SUSPENDED: 'suspended',
  ERROR: 'error',
};

const INVOICE_TONE: Record<InvoiceStatusDTO, Tone> = { PENDING: 'pending', PAID: 'running', FAILED: 'error', CANCELED: 'stopped' };

const CONVERSATION_TONE: Record<ConversationStatusDTO, Tone> = { WAITING: 'pending', ACTIVE: 'running', CLOSED: 'stopped' };

const DOT: Record<Tone, string> = {
  running: 'bg-status-running',
  pending: 'bg-status-pending',
  stopped: 'bg-status-stopped',
  error: 'bg-status-error',
  suspended: 'bg-status-suspended',
};

/** Status sempre com ponto + texto, nunca só com cor (plano §14.6). Estados transitórios pulsam. */
function Badge({ tone, label, pulse }: { tone: Tone; label: string; pulse: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      data-tone={tone}
    >
      <span aria-hidden className={cn('size-2 rounded-full', DOT[tone], pulse && 'animate-pulse motion-reduce:animate-none')} />
      {label}
    </span>
  );
}

export function VpsStatusBadge({ status }: { status: VpsStatusDTO }) {
  const { t } = useTranslation();
  const tone = VPS_TONE[status];
  return <Badge tone={tone} label={t(`vpsStatus.${status}`)} pulse={tone === 'pending' && status !== 'PENDING_PAYMENT'} />;
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusDTO }) {
  const { t } = useTranslation();
  return <Badge tone={INVOICE_TONE[status]} label={t(`invoiceStatus.${status}`)} pulse={false} />;
}

export function ConversationStatusBadge({ status }: { status: ConversationStatusDTO }) {
  const { t } = useTranslation('support');
  return <Badge tone={CONVERSATION_TONE[status]} label={t(`status.${status}`)} pulse={status === 'WAITING'} />;
}
