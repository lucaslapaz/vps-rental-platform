import { z } from 'zod';

export const SUPPORT_MESSAGE_MAX = 2000;

/** Corpo de uma mensagem do chat: 1–2000 caracteres depois de tirar os espaços das pontas (plano §13.2). */
export const messageBodySchema = z.string().trim().min(1, { error: 'required' }).max(SUPPORT_MESSAGE_MAX, { error: 'tooLong' });

/** POST /api/support/conversations: assunto + primeira mensagem. */
export const openConversationSchema = z.object({
  subject: z.string().trim().min(3, { error: 'subjectTooShort' }).max(150, { error: 'tooLong' }),
  message: messageBodySchema,
});
export type OpenConversationInput = z.input<typeof openConversationSchema>;

/** POST …/messages (alternativa REST ao socket). */
export const sendBodySchema = z.object({ body: messageBodySchema });

/** Evento de socket support:message:send. */
export const sendMessageSchema = z.object({ conversationId: z.uuid({ error: 'id' }), body: messageBodySchema });

/** GET …/messages?after=<id> (reconexão: só o que chegou depois) ou ?before=<id> (páginas antigas). */
export const messagesQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  before: z.coerce.number().int().min(1).optional(),
});
