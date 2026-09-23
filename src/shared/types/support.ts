export type ConversationStatusDTO = 'WAITING' | 'ACTIVE' | 'CLOSED';

/**
 * Mensagem do chat (plano §13). `sender` null = mensagem do sistema: o texto não é gravado pronto, e sim um código
 * (`system`) que a tela traduz, com o nome envolvido em `systemName` ("Carla iniciou o atendimento").
 */
export interface SupportMessageDTO {
  id: number;
  conversationId: string;
  sender: { id: string; name: string; role: 'customer' | 'agent' } | null;
  body: string;
  system: SupportSystemEvent | null;
  systemName: string | null;
  createdAt: string;
}

export type SupportSystemEvent = 'queued' | 'claimed' | 'released' | 'closed';

export interface SupportConversationDTO {
  id: string;
  subject: string;
  status: ConversationStatusDTO;
  customer: { id: string; name: string; email: string };
  agent: { id: string; name: string } | null;
  /** Posição na fila (1 = próximo); só em WAITING. */
  queuePosition: number | null;
  createdAt: string;
  claimedAt: string | null;
  closedAt: string | null;
}

/** Item da fila para o técnico: só o necessário para decidir quem atender (plano §13.1: nada de VPS nem faturas). */
export interface QueueItemDTO {
  id: string;
  subject: string;
  customer: { name: string; email: string };
  preview: string;
  createdAt: string;
}
