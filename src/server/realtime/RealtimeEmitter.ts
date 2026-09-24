import type { ServerToClientEvents } from '../../shared/constants/events.ts';

type Emit = <E extends keyof ServerToClientEvents>(room: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) => void;

/**
 * Ponto único de emissão de eventos em tempo real. Quem emite (jobs, services) não conhece o Socket.IO. O hub existe
 * desde o boot (os controllers são criados antes do Socket.IO) e passa a emitir de verdade quando `attach` é chamado.
 * Sem Socket.IO (testes), só guarda os últimos eventos em `sent`.
 */
export class RealtimeHub {
  readonly sent: { room: string; event: string; args: unknown[] }[] = [];
  private emit?: Emit;
  private disconnect?: (room: string) => void;
  private readonly sessionEndedListeners = new Set<(sessionId: string) => void>();

  attach(emit: Emit, disconnect: (room: string) => void) {
    this.emit = emit;
    this.disconnect = disconnect;
  }

  /** Sala dos técnicos online (quem tem support:queue:read): fila ao vivo. */
  toAgents<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.send('agents', event, ...args);
  }

  /** Outros canais presos à sessão (o WebSocket do console) se registram para fechar junto. */
  onSessionEnded(listener: (sessionId: string) => void) {
    this.sessionEndedListeners.add(listener);
    return () => this.sessionEndedListeners.delete(listener);
  }

  /** Sessão revogada: avisa as abas dela e fecha os sockets e consoles (o handshake só autentica uma vez). */
  endSession(sessionId: string) {
    this.toSession(sessionId, 'session:revoked');
    this.disconnect?.(`session:${sessionId}`);
    for (const listener of this.sessionEndedListeners) listener(sessionId);
  }

  toUser<E extends keyof ServerToClientEvents>(userId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.send(`user:${userId}`, event, ...args);
  }

  toSession<E extends keyof ServerToClientEvents>(sessionId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.send(`session:${sessionId}`, event, ...args);
  }

  private send<E extends keyof ServerToClientEvents>(room: string, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
    this.sent.push({ room, event, args });
    if (this.sent.length > 200) this.sent.shift();
    this.emit?.(room, event, ...args);
  }
}
