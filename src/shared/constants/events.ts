import type { VpsStatusDTO } from '../types/catalog.ts';

/** Etapas da linha do tempo de criação (plano §14.5), na ordem em que acontecem. */
export const PROVISION_STEPS = ['payment', 'ip', 'cloning', 'configuring', 'starting', 'booting', 'access', 'ready'] as const;
export type ProvisionStep = (typeof PROVISION_STEPS)[number];

/** Eventos do Socket.IO servidor → cliente (plano §15). */
export interface ServerToClientEvents {
  'vps:status': (payload: { vpsId: string; status: VpsStatusDTO; lastError?: string | null }) => void;
  'vps:progress': (payload: { vpsId: string; step: ProvisionStep; at: string }) => void;
  'session:revoked': () => void;
}

// biome-ignore lint/complexity/noBannedTypes: o cliente ainda não envia eventos (o chat entra na Fase 8)
export type ClientToServerEvents = {};
