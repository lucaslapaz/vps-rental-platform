import { SUPPORT_MESSAGE_MAX } from '@shared/schemas/support';
import type { SupportConversationDTO, SupportMessageDTO } from '@shared/types/support';
import { useQueryClient } from '@tanstack/react-query';
import { SendHorizontal } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useSocket } from '@/features/realtime/RealtimeProvider';
import { api, apiGet } from '@/lib/api';
import { errorMessage, translateKey } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { mergeMessages, supportKeys, systemText, useMessages } from './queries';

interface Pending {
  tempId: string;
  body: string;
  failed: boolean;
}

const timeOf = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/**
 * Chat de uma conversa (plano §13.2), igual para cliente e técnico. Mensagens chegam pelo socket (`support:message:new`)
 * e entram no cache; o envio é otimista: a mensagem aparece na hora e é trocada pela persistida quando chega o ack. Se o
 * socket cair, ao reconectar busca só o que veio depois da última mensagem recebida.
 */
export function ChatPanel({ conversation, viewerId }: { conversation: SupportConversationDTO; viewerId: string }) {
  const { t, i18n } = useTranslation('support');
  const locale = i18n.resolvedLanguage ?? 'pt-BR';
  const socket = useSocket();
  const queryClient = useQueryClient();
  const messages = useMessages(conversation.id);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [typing, setTyping] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const key = supportKeys.messages(conversation.id);
  const closed = conversation.status === 'CLOSED';
  const lastId = useRef(0);
  lastId.current = messages.data?.at(-1)?.id ?? 0;

  useEffect(() => {
    if (!socket) return;
    const key = supportKeys.messages(conversation.id);
    const onMessage = (m: SupportMessageDTO) => {
      if (m.conversationId !== conversation.id) return;
      queryClient.setQueryData<SupportMessageDTO[]>(key, (cur) => mergeMessages(cur, [m]));
      if (m.sender && m.sender.id !== viewerId) setTyping(null);
    };
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    const onTyping = (p: { conversationId: string; userName: string }) => {
      if (p.conversationId !== conversation.id) return;
      setTyping(p.userName);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(null), 3500);
    };
    // Reconexão: o que chegou enquanto o socket estava fora.
    const onReconnect = () => {
      void apiGet<{ messages: SupportMessageDTO[] }>(`/support/conversations/${conversation.id}/messages?after=${lastId.current}`)
        .then(({ messages: missed }) => queryClient.setQueryData<SupportMessageDTO[]>(key, (cur) => mergeMessages(cur, missed)))
        .catch(() => undefined);
    };
    socket.on('support:message:new', onMessage);
    socket.on('support:typing', onTyping);
    socket.io.on('reconnect', onReconnect);
    return () => {
      clearTimeout(typingTimer);
      socket.off('support:message:new', onMessage);
      socket.off('support:typing', onTyping);
      socket.io.off('reconnect', onReconnect);
    };
  }, [socket, conversation.id, viewerId, queryClient]);

  // Rola para o fim quando chega mensagem nova (ou a pendente aparece).
  const count = (messages.data?.length ?? 0) + pending.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: rolar só quando o número de mensagens muda
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [count, typing]);

  const send = async (body: string, retryOf?: string) => {
    const text = body.trim();
    if (!text) return;
    const tempId = retryOf ?? `tmp-${Date.now()}-${Math.random()}`;
    setPending((p) => [...p.filter((x) => x.tempId !== tempId), { tempId, body: text, failed: false }]);
    const done = (m: SupportMessageDTO) => {
      queryClient.setQueryData<SupportMessageDTO[]>(key, (cur) => mergeMessages(cur, [m]));
      setPending((p) => p.filter((x) => x.tempId !== tempId));
    };
    const fail = (message: string) => {
      setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: true } : x)));
      toast.error(message);
    };
    if (socket?.connected) {
      socket.timeout(10_000).emit('support:message:send', { conversationId: conversation.id, body: text }, (err, ack) => {
        if (err) return fail(t('chat.failed'));
        if (ack.ok) done(ack.message);
        else fail(translateKey(`errors:${ack.code}`, t('chat.failed')));
      });
    } else {
      // Sem socket: o mesmo envio por REST.
      try {
        done(
          (await api<{ message: SupportMessageDTO }>('POST', `/support/conversations/${conversation.id}/messages`, { body: text })).message,
        );
      } catch (err) {
        fail(errorMessage(err));
      }
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(draft);
      setDraft('');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="chat">
      <div className="flex h-[55vh] min-h-72 flex-col gap-2 overflow-y-auto rounded-lg border bg-background p-3" aria-live="polite">
        {messages.isPending ? <Skeleton className="h-20 w-full" /> : null}
        {messages.data?.map((m) =>
          m.system ? (
            <p key={m.id} className="my-1 text-center text-xs text-muted-foreground" data-system={m.system}>
              {systemText(m.system, m.systemName)} · {timeOf(m.createdAt, locale)}
            </p>
          ) : (
            <Bubble key={m.id} own={m.sender?.id === viewerId} name={m.sender?.id === viewerId ? t('chat.you') : (m.sender?.name ?? '')}>
              <span className="whitespace-pre-wrap break-words">{m.body}</span>
              <time className="self-end text-[0.7rem] text-muted-foreground">{timeOf(m.createdAt, locale)}</time>
            </Bubble>
          ),
        )}
        {pending.map((p) => (
          <Bubble key={p.tempId} own name={t('chat.you')} pending>
            <span className="whitespace-pre-wrap break-words">{p.body}</span>
            {p.failed ? (
              <button
                type="button"
                className="self-end text-[0.7rem] text-destructive underline"
                onClick={() => void send(p.body, p.tempId)}
              >
                {t('chat.failed')}
              </button>
            ) : (
              <span className="self-end text-[0.7rem] text-muted-foreground">{t('chat.sending')}</span>
            )}
          </Bubble>
        ))}
        {typing ? <p className="text-xs italic text-muted-foreground">{t('chat.typing', { name: typing })}</p> : null}
        <div ref={bottom} />
      </div>

      {closed ? (
        <p className="text-sm text-muted-foreground">{t('chat.closed')}</p>
      ) : (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
            setDraft('');
          }}
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              rows={2}
              maxLength={SUPPORT_MESSAGE_MAX}
              placeholder={t('chat.placeholder')}
              aria-label={t('chat.placeholder')}
              onChange={(e) => {
                setDraft(e.target.value);
                socket?.emit('support:typing', { conversationId: conversation.id });
              }}
              onKeyDown={onKeyDown}
              className="min-h-12 flex-1 resize-none"
              data-testid="chat-input"
            />
            <Button type="submit" disabled={!draft.trim()} aria-label={t('chat.send')} data-testid="chat-send">
              <SendHorizontal />
              <span className="hidden sm:inline">{t('chat.send')}</span>
            </Button>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t('chat.hint')}</span>
            <span className="tabular-nums">{t('chat.counter', { count: draft.length, max: SUPPORT_MESSAGE_MAX })}</span>
          </div>
        </form>
      )}
    </div>
  );
}

function Bubble({ own, name, pending, children }: { own: boolean; name: string; pending?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('flex max-w-[80%] flex-col gap-0.5', own ? 'self-end items-end' : 'self-start items-start')} data-own={own}>
      <span className="px-1 text-[0.7rem] font-medium text-muted-foreground">{name}</span>
      <div
        className={cn(
          'flex flex-col gap-1 rounded-2xl px-3 py-2 text-sm',
          own ? 'rounded-br-sm bg-accent text-accent-foreground' : 'rounded-bl-sm bg-muted',
          pending && 'opacity-70',
        )}
      >
        {children}
      </div>
    </div>
  );
}
