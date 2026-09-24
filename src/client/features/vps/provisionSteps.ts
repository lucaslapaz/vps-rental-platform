import { PROVISION_STEPS, type ProvisionStep, REINSTALL_STEPS } from '@shared/constants/events';
import type { VpsEventDTO } from '@shared/types/catalog';

/**
 * Etapas de uma VPS em PROVISIONING, reconstruídas do histórico (sobrevivem a um refresh). Numa reinstalação (Fase 10),
 * só contam os eventos depois do último pedido de reinstalação: as etapas antigas da criação não aparecem como feitas.
 */
export function provisionState(events: readonly VpsEventDTO[] | undefined) {
  const list = events ?? [];
  let start = -1;
  list.forEach((e, i) => {
    if (e.action === 'reinstall' && e.status === 'requested') start = i;
  });
  const reinstall = start >= 0;
  const steps: readonly ProvisionStep[] = reinstall ? REINSTALL_STEPS : PROVISION_STEPS;
  const isStep = (v: string | null): v is ProvisionStep => (steps as readonly string[]).includes(v ?? '');

  const reached = new Map<ProvisionStep, string>();
  for (const e of list.slice(start + 1)) {
    if (!reinstall && e.action === 'payment' && e.status === 'succeeded') reached.set('payment', e.createdAt);
    if (e.action === 'provision' && isStep(e.message)) reached.set(e.message, e.createdAt);
  }
  const lastIndex = Math.max(0, ...[...reached.keys()].map((s) => steps.indexOf(s)));
  return {
    mode: reinstall ? ('reinstall' as const) : ('create' as const),
    steps,
    reached,
    lastIndex,
    current: steps[lastIndex] as ProvisionStep,
  };
}
