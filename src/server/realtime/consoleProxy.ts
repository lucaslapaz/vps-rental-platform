import type http from 'node:http';
import type { Duplex } from 'node:stream';
import type { DependencyContainer } from 'tsyringe';
import { type RawData, WebSocket, WebSocketServer } from 'ws';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import type { VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { ConsoleService } from '../services/ConsoleService.ts';
import { SessionService } from '../services/SessionService.ts';
import type { Logger } from '../utils/logger.ts';
import { authenticateHandshake, isAllowedOrigin } from './handshake.ts';
import type { RealtimeHub } from './RealtimeEmitter.ts';

const PATH = /^\/ws\/console\/([A-Za-z0-9_-]{16,64})$/;
/** Sem tráfego em nenhum sentido por este tempo → encerra (plano §10.5). */
const IDLE_MS = 15 * 60 * 1000;
/** Mensagens do navegador enquanto o lado do Proxmox ainda conecta. */
const MAX_BUFFERED = 256;

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/**
 * Proxy do console (plano §10.5): o navegador fala só com a Favo (mesma origem, cookie de sessão) e o backend abre o
 * `vncwebsocket` do Proxmox com o token da plataforma, que nunca sai do servidor. Os frames VNC passam intactos nos dois
 * sentidos. Trata só `/ws/console/*` no evento "upgrade"; o Socket.IO (com `destroyUpgrade: false`) e o HMR do Vite
 * cuidam dos seus caminhos.
 */
export function attachConsoleProxy(httpServer: http.Server, di: DependencyContainer) {
  const env = di.resolve<Env>(TOKENS.Env);
  const logger = di.resolve<Logger>(TOKENS.Logger);
  const sessions = di.resolve(SessionService);
  const consoles = di.resolve(ConsoleService);
  const vms = di.resolve<VirtualizationProvider>(TOKENS.VirtualizationProvider);
  const audit = di.resolve(AuditLogRepository);
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 16 * 1024 * 1024,
    // O noVNC pede o subprotocolo "binary"; o Proxmox responde com o mesmo.
    handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
  });
  // Cada console aberto, com a sessão que o abriu: revogar a sessão (logout em outra aba, troca de senha) fecha o console.
  const open = new Map<WebSocket, string>();
  const unsubscribe = di.resolve<RealtimeHub>(TOKENS.Realtime).onSessionEnded((sessionId) => {
    for (const [client, owner] of open) if (owner === sessionId) client.close(4001, 'session revoked');
  });

  httpServer.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const match = PATH.exec(pathname);
    if (!match) {
      // /ws/* é nosso: um caminho inválido recebe 404 na hora (sem isso, ninguém responde e o socket fica pendurado).
      if (pathname.startsWith('/ws/')) reject(socket, 404, 'Not Found');
      return;
    }
    void (async () => {
      if (!isAllowedOrigin(env, req)) return reject(socket, 403, 'Forbidden');
      const user = await authenticateHandshake(env, sessions, req);
      if (!user) return reject(socket, 401, 'Unauthorized');
      if (!user.can('vps:console:own')) return reject(socket, 403, 'Forbidden');
      const session = consoles.consume(match[1] as string, { id: user.id, sessionId: user.sessionId });
      if (!session) return reject(socket, 403, 'Forbidden');

      wss.handleUpgrade(req, socket, head, (client) => {
        const upstream = vms.connectConsole(session.vmid, session.ticket);
        const started = Date.now();
        let lastActivity = started;
        const queue: { data: RawData; binary: boolean }[] = [];
        // Encerrada pelo painel de conexões: fecha o navegador com o código recebido e já derruba o lado do Proxmox (não
        // espera o navegador responder; uma aba travada não segura a vaga).
        consoles.register(session, (code, reason) => {
          if (client.readyState === WebSocket.OPEN) client.close(code, reason);
          finish();
        });
        open.set(client, user.sessionId);
        audit
          .record({
            action: 'vps.console_opened',
            actorId: user.id,
            targetType: 'vps',
            targetId: session.vpsId,
            ip: req.socket.remoteAddress ?? null,
          })
          .catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'console: falha ao gravar a auditoria'));

        const idle = setInterval(() => {
          if (Date.now() - lastActivity > IDLE_MS) client.close(4000, 'idle');
        }, 30_000);
        idle.unref();

        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearInterval(idle);
          open.delete(client);
          consoles.unregister(session.connectionId);
          if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
          if (client.readyState === WebSocket.OPEN) client.close(1000);
          audit
            .record({
              action: 'vps.console_closed',
              actorId: user.id,
              targetType: 'vps',
              targetId: session.vpsId,
              metadata: { seconds: Math.round((Date.now() - started) / 1000) },
              ip: req.socket.remoteAddress ?? null,
            })
            .catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'console: falha ao gravar a auditoria'));
        };

        // Terminal (termproxy): o PROXY autentica com "<user>:<ticket>\n" e espera o "OK" antes de liberar o tráfego;
        // o ticket nunca vai para o navegador. No VNC, a autenticação é a do próprio protocolo (senha dada ao noVNC).
        let ready = session.type !== 'serial';
        const flush = () => {
          for (const m of queue.splice(0)) upstream.send(m.data, { binary: m.binary });
        };
        client.on('message', (data, binary) => {
          lastActivity = Date.now();
          if (ready && upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
          else if (queue.length < MAX_BUFFERED) queue.push({ data, binary });
        });
        upstream.on('open', () => {
          if (session.type === 'serial') upstream.send(`${session.terminalUser}:${session.ticket.ticket}\n`);
          else flush();
        });
        upstream.on('message', (data, binary) => {
          lastActivity = Date.now();
          if (!ready) {
            const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
            if (bytes[0] !== 0x4f || bytes[1] !== 0x4b) {
              // Sem "OK": ticket recusado pelo Proxmox.
              logger.warn({ vpsId: session.vpsId }, 'console: o termproxy recusou o ticket');
              client.close(1011, 'terminal auth');
              return finish();
            }
            ready = true;
            flush();
            const rest = bytes.subarray(2);
            if (rest.length && client.readyState === WebSocket.OPEN) client.send(rest, { binary: true });
            return;
          }
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary });
        });
        upstream.on('error', (err) => {
          logger.warn({ err: err.message, vpsId: session.vpsId }, 'console: erro na conexão com o Proxmox');
          if (client.readyState === WebSocket.OPEN) client.close(1011, 'upstream');
          finish();
        });
        upstream.on('close', finish);
        client.on('close', finish);
        client.on('error', finish);
      });
    })().catch((err) => {
      logger.error({ err }, 'console: erro no upgrade');
      reject(socket, 500, 'Internal Server Error');
    });
  });

  return {
    /** Encerramento gracioso: fecha os consoles abertos. */
    close() {
      unsubscribe();
      for (const client of open.keys()) client.close(1001, 'shutdown');
      wss.close();
    },
  };
}
