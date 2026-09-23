import type { VpsStatusDTO } from '../types/catalog.ts';
import type { ConversationStatusDTO, QueueItemDTO, SupportMessageDTO } from '../types/support.ts';

/** Etapas da linha do tempo de criação (plano §14.5), na ordem em que acontecem. */
export const PROVISION_STEPS = ['payment', 'ip', 'cloning', 'configuring', 'starting', 'booting', 'access', 'ready'] as const;
export type ProvisionStep = (typeof PROVISION_STEPS)[number];

/** Eventos do Socket.IO servidor → cliente (plano §15). */
export interface ServerToClientEvents {
  'vps:status': (payload: { vpsId: string; status: VpsStatusDTO; lastError?: string | null }) => void;
  'vps:progress': (payload: { vpsId: string; step: ProvisionStep; at: string }) => void;
  'session:revoked': () => void;
  // Suporte (plano §13.2 e §15)
  'support:message:new': (message: SupportMessageDTO) => void;
  'support:conversation:updated': (payload: {
    id: string;
    status: ConversationStatusDTO;
    agent: { id: string; name: string } | null;
    queuePosition: number | null;
  }) => void;
  'support:queue:updated': (payload: { waiting: QueueItemDTO[] }) => void;
  'support:typing': (payload: { conversationId: string; userName: string }) => void;
}

/** Resposta (ack) do envio de mensagem: a mensagem persistida (a tela troca a otimista por ela) ou o código do erro. */
export type SendMessageAck = { ok: true; message: SupportMessageDTO } | { ok: false; code: string };

/** Eventos do Socket.IO cliente → servidor: só mensagens do chat. Criar, assumir e encerrar ficam em REST com CSRF. */
export interface ClientToServerEvents {
  'support:message:send': (payload: { conversationId: string; body: string }, ack: (result: SendMessageAck) => void) => void;
  'support:typing': (payload: { conversationId: string }) => void;
}
