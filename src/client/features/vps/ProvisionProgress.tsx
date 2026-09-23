import { PROVISION_STEPS, type ProvisionStep } from '@shared/constants/events';
import { VPS_ERROR_CODES, type VpsErrorCode } from '@shared/constants/vps';
import type { VpsDTO } from '@shared/types/catalog';
import { useTranslation } from 'react-i18next';
import { useVpsEvents } from './queries';

const isStep = (v: string | null): v is ProvisionStep => (PROVISION_STEPS as readonly string[]).includes(v ?? '');

/**
 * Etapa atual da criação (plano §14.5), reconstruída do histórico: sobrevive a um refresh. O socket invalida o
 * histórico a cada `vps:progress`, então a etapa avança sozinha. A linha do tempo completa fica na página da VPS (Fase 7).
 */
export function ProvisionProgress({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  const events = useVpsEvents(vps.id, vps.status === 'PROVISIONING');
  if (vps.status !== 'PROVISIONING') return null;

  const last = events.data?.filter((e) => e.action === 'provision' && isStep(e.message)).at(-1)?.message;
  const step: ProvisionStep = isStep(last ?? null) ? (last as ProvisionStep) : 'payment';
  const current = PROVISION_STEPS.indexOf(step) + 1;
  const total = PROVISION_STEPS.length;

  return (
    <div className="mt-1 flex flex-col gap-1" data-testid="provision-progress" data-step={step}>
      <div
        className="h-1 w-32 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={current}
        aria-label={t('progress.step', { current, total })}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(current / total) * 100}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{t(`progress.${step}`)}</span>
    </div>
  );
}

/** Motivo do erro, traduzido pelo código gravado em `lastError`. */
export function VpsErrorReason({ vps }: { vps: VpsDTO }) {
  const { t } = useTranslation('vps');
  const code = vps.lastError as VpsErrorCode | null;
  if (vps.status !== 'ERROR' || !code || !VPS_ERROR_CODES.includes(code)) return null;
  return <p className="mt-1 max-w-64 text-xs text-destructive">{t(`lastError.${code}`)}</p>;
}
