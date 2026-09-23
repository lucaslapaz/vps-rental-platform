import net from 'node:net';

/** Tenta abrir uma conexão TCP; true se a porta aceitou antes do timeout. */
export function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Repete o teste até a porta abrir ou o prazo acabar. */
export async function waitForTcp(host: string, port: number, timeoutMs: number, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpProbe(host, port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
