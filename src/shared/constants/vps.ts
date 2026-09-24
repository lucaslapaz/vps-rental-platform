import type { VpsStatusDTO } from '../types/catalog.ts';

/** Ações de energia (plano §11.4). `shutdown` é ACPI (com fallback para `stop`); `stop`/`reset` são "tirar da tomada". */
export const POWER_ACTIONS = ['start', 'shutdown', 'stop', 'reboot', 'reset'] as const;
export type PowerActionName = (typeof POWER_ACTIONS)[number];

/**
 * Máquina de estados (plano §11.1): de quais estados cada operação pode partir e por qual estado transitório passa.
 * O servidor aplica com `updateMany` (lock otimista); o frontend usa a mesma tabela para habilitar os botões.
 */
export const VPS_TRANSITIONS = {
  start: { from: ['STOPPED'], via: 'STARTING' },
  shutdown: { from: ['RUNNING'], via: 'STOPPING' },
  stop: { from: ['RUNNING'], via: 'STOPPING' },
  reboot: { from: ['RUNNING'], via: 'REBOOTING' },
  reset: { from: ['RUNNING'], via: 'REBOOTING' },
  resize: { from: ['RUNNING', 'STOPPED'], via: 'UPDATING' },
  delete: { from: ['RUNNING', 'STOPPED', 'SUSPENDED', 'ERROR'], via: 'DELETING' },
} as const satisfies Record<string, { from: readonly VpsStatusDTO[]; via: VpsStatusDTO }>;
export type VpsOperation = keyof typeof VPS_TRANSITIONS;

/** Estados em que há uma operação em andamento (a UI mostra um spinner e bloqueia as ações). */
export const BUSY_STATUSES: readonly VpsStatusDTO[] = ['PROVISIONING', 'STARTING', 'STOPPING', 'REBOOTING', 'UPDATING', 'DELETING'];

export function canRun(operation: VpsOperation, status: VpsStatusDTO) {
  return (VPS_TRANSITIONS[operation].from as readonly VpsStatusDTO[]).includes(status);
}

/**
 * Códigos gravados em `Vps.lastError`: o cliente traduz (vps:lastError.<código>). O detalhe técnico, que pode ter nomes
 * internos do Proxmox, fica só no `Job.lastError` e nos logs.
 */
export const VPS_ERROR_CODES = ['PROVISION_FAILED', 'ACTION_FAILED', 'RESIZE_FAILED', 'DELETE_FAILED', 'VM_MISSING'] as const;
export type VpsErrorCode = (typeof VPS_ERROR_CODES)[number];
