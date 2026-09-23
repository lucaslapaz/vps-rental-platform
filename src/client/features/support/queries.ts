import type { QueueItemDTO, SupportConversationDTO, SupportMessageDTO, SupportSystemEvent } from '@shared/types/support';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { translateKey } from '@/lib/errors';

/** Queries do suporte (plano §13). O socket mantém o cache atualizado; o REST cobre a primeira carga e as reconexões. */
export const supportKeys = {
  current: ['support', 'current'] as const,
  queue: ['support', 'queue'] as const,
  mine: ['support', 'mine'] as const,
  messages: (id: string) => ['support', 'messages', id] as const,
};

export const useCurrentConversation = (enabled = true) =>
  useQuery({
    queryKey: supportKeys.current,
    queryFn: async () => (await apiGet<{ conversation: SupportConversationDTO | null }>('/support/conversations/current')).conversation,
    enabled,
  });

export const useQueue = () =>
  useQuery({ queryKey: supportKeys.queue, queryFn: async () => (await apiGet<{ waiting: QueueItemDTO[] }>('/support/queue')).waiting });

export const useMyConversations = () =>
  useQuery({
    queryKey: supportKeys.mine,
    queryFn: async () => (await apiGet<{ conversations: SupportConversationDTO[] }>('/support/my-conversations')).conversations,
  });

export const useMessages = (conversationId: string) =>
  useQuery({
    queryKey: supportKeys.messages(conversationId),
    queryFn: async () => (await apiGet<{ messages: SupportMessageDTO[] }>(`/support/conversations/${conversationId}/messages`)).messages,
  });

/** Junta mensagens novas às que já estão no cache, sem repetir (a mesma pode chegar pelo ack e pelo evento). */
export function mergeMessages(current: SupportMessageDTO[] | undefined, incoming: SupportMessageDTO[]) {
  const byId = new Map((current ?? []).map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** Texto de uma mensagem do sistema no idioma da tela. */
export function systemText(event: SupportSystemEvent, name: string | null) {
  return translateKey(`support:system.${event}`, event, { name: name ?? '' });
}
