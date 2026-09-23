import type http from 'node:http';
import { Server } from 'socket.io';
import type { DependencyContainer } from 'tsyringe';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/constants/events.ts';
import { sendMessageSchema } from '../../shared/schemas/support.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { AuthenticatedUser } from '../models/AuthenticatedUser.ts';
import { SessionService } from '../services/SessionService.ts';
import { SupportService } from '../services/SupportService.ts';
import { AppError } from '../utils/errors.ts';
import type { Logger } from '../utils/logger.ts';
import { authenticateHandshake, isAllowedOrigin } from './handshake.ts';
import type { RealtimeHub } from './RealtimeEmitter.ts';

interface SocketData {
  user: AuthenticatedUser;
}

export type FavoIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/**
 * Socket.IO no MESMO http.Server do app (plano §13.2):
 * - `destroyUpgrade: false`: por padrão o engine.io destrói em 1 s os upgrades que não são dele, o que derrubaria o
 *   HMR do Vite e, na Fase 7, o proxy do console (CLAUDE.md N7);
 * - `allowRequest` confere a origem (WebSocket não passa por CORS: proteção contra Cross-Site WebSocket Hijacking);
 * - o handshake autentica pelo cookie de sessão HttpOnly, e cada usuário entra na sala `user:<id>`.
 */
export function attachSocketIo(httpServer: http.Server, di: DependencyContainer): FavoIo {
  const env = di.resolve<Env>(TOKENS.Env);
  const logger = di.resolve<Logger>(TOKENS.Logger);
  const sessions = di.resolve(SessionService);
  const support = di.resolve(SupportService);

  const io: FavoIo = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    destroyUpgrade: false,
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(env, req)),
  });

  io.use(async (socket, next) => {
    const user = await authenticateHandshake(env, sessions, socket.request);
    if (!user) return next(new Error('UNAUTHENTICATED'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    void socket.join(`user:${user.id}`);
    void socket.join(`session:${user.sessionId}`);
    // Técnicos online recebem a fila ao vivo (plano §13.2).
    if (user.can('support:queue:read')) void socket.join('agents');
    logger.debug({ userId: user.id }, 'socket conectado');

    // Mensagens do chat pelo socket, com ack (a tela troca a mensagem otimista pela persistida).
    socket.on('support:message:send', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => undefined;
      const parsed = sendMessageSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, code: 'VALIDATION_ERROR' });
      try {
        reply({ ok: true, message: await support.send(user, parsed.data.conversationId, parsed.data.body) });
      } catch (err) {
        reply({ ok: false, code: err instanceof AppError ? err.code : 'INTERNAL_ERROR' });
        if (!(err instanceof AppError)) logger.error({ err }, 'support:message:send falhou');
      }
    });
    // "Digitando…": no máximo um aviso a cada 2 s por socket.
    let lastTyping = 0;
    socket.on('support:typing', (payload) => {
      if (Date.now() - lastTyping < 2000 || typeof payload?.conversationId !== 'string') return;
      lastTyping = Date.now();
      void support.typing(user, payload.conversationId).catch(() => undefined);
    });
  });

  // A partir daqui o hub (usado por jobs e services) emite de verdade.
  di.resolve<RealtimeHub>(TOKENS.Realtime).attach(
    (room, event, ...args) => io.to(room).emit(event, ...args),
    (room) => io.in(room).disconnectSockets(true),
  );
  return io;
}
