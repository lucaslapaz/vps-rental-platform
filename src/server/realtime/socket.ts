import type http from 'node:http';
import { Server } from 'socket.io';
import type { DependencyContainer } from 'tsyringe';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/constants/events.ts';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import { cookieNames } from '../http/cookies.ts';
import type { AuthenticatedUser } from '../models/AuthenticatedUser.ts';
import { SessionService } from '../services/SessionService.ts';
import type { Logger } from '../utils/logger.ts';
import type { RealtimeHub } from './RealtimeEmitter.ts';

interface SocketData {
  user: AuthenticatedUser;
}

export type FavoIo = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Lê um cookie do header bruto do handshake (o Socket.IO não passa pelo cookie-parser do Express). */
function readCookie(header: string | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

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
  const sessionCookie = cookieNames(env).session;

  const io: FavoIo = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    destroyUpgrade: false,
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const selfOrigin = `http://${req.headers.host}`;
      callback(null, !origin || origin === env.APP_ORIGIN || origin === selfOrigin || origin === `https://${req.headers.host}`);
    },
  });

  io.use(async (socket, next) => {
    const token = readCookie(socket.handshake.headers.cookie, sessionCookie);
    const result = token ? await sessions.authenticate(token).catch(() => null) : null;
    if (!result) return next(new Error('UNAUTHENTICATED'));
    socket.data.user = result.user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    void socket.join(`user:${user.id}`);
    void socket.join(`session:${user.sessionId}`);
    logger.debug({ userId: user.id }, 'socket conectado');
  });

  // A partir daqui o hub (usado por jobs e services) emite de verdade.
  di.resolve<RealtimeHub>(TOKENS.Realtime).attach(
    (room, event, ...args) => io.to(room).emit(event, ...args),
    (room) => io.in(room).disconnectSockets(true),
  );
  return io;
}
