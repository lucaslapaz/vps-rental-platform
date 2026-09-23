import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOKENS } from '../../src/server/container/tokens.ts';
import type { RealtimeHub } from '../../src/server/realtime/RealtimeEmitter.ts';
import { attachSocketIo } from '../../src/server/realtime/socket.ts';
import { SessionService } from '../../src/server/services/SessionService.ts';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { TestClient, uniqueEmail } from '../helpers/client.ts';

const { app, di, env } = createTestApp();
const server = http.createServer(app);
const io = attachSocketIo(server, di);
const hub = di.resolve<RealtimeHub>(TOKENS.Realtime);
const db = testPrisma();
const createdUsers: string[] = [];
let url = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  io.disconnectSockets(true);
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await db.session.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: createdUsers } } });
  await db.user.deleteMany({ where: { id: { in: createdUsers } } });
  await closeTestPrisma();
});

async function loggedIn() {
  const c = new TestClient(app);
  await c.init();
  const res = await c.send('post', '/api/auth/register', {
    name: 'Cliente Socket',
    email: uniqueEmail('socket'),
    password: 'senha-forte-123',
  });
  createdUsers.push(res.body.user.id);
  const cookie = [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  return { c, userId: res.body.user.id as string, cookie };
}

function open(headers: Record<string, string>) {
  const s = connect(url, { transports: ['websocket'], extraHeaders: headers, reconnection: false, forceNew: true });
  sockets.push(s);
  return s;
}

const outcome = (s: Socket) =>
  new Promise<'connected' | string>((resolve) => {
    s.once('connect', () => resolve('connected'));
    s.once('connect_error', (err) => resolve(err.message));
  });

describe('Socket.IO', () => {
  it('sem sessão → recusado (UNAUTHENTICATED)', async () => {
    expect(await outcome(open({ Origin: env.APP_ORIGIN }))).toBe('UNAUTHENTICATED');
  });

  it('origem de outro site → recusado (Cross-Site WebSocket Hijacking)', async () => {
    const { cookie } = await loggedIn();
    expect(await outcome(open({ Origin: 'https://evil.example', Cookie: cookie }))).not.toBe('connected');
  });

  it('autenticado recebe só os eventos da própria sala; revogar a sessão avisa e desconecta', async () => {
    const a = await loggedIn();
    const b = await loggedIn();
    const sa = open({ Origin: env.APP_ORIGIN, Cookie: a.cookie });
    const sb = open({ Origin: env.APP_ORIGIN, Cookie: b.cookie });
    expect(await Promise.all([outcome(sa), outcome(sb)])).toEqual(['connected', 'connected']);

    const receivedByB: unknown[] = [];
    sb.on('vps:status', (p) => receivedByB.push(p));
    const got = new Promise((resolve) => sa.once('vps:status', resolve));
    hub.toUser(a.userId, 'vps:status', { vpsId: 'x', status: 'RUNNING', lastError: null });
    expect(await got).toEqual({ vpsId: 'x', status: 'RUNNING', lastError: null });
    expect(receivedByB).toEqual([]);

    const revoked = new Promise((resolve) => sa.once('session:revoked', () => resolve(true)));
    const disconnected = new Promise((resolve) => sa.once('disconnect', (reason) => resolve(reason)));
    const sessions = await a.c.get('/api/account/sessions');
    const current = sessions.body.sessions.find((s: { current: boolean }) => s.current);
    // O mesmo caminho do DELETE /api/account/sessions/:id feito de outra aba.
    await di.resolve(SessionService).revoke(current.id, a.userId);
    expect(await revoked).toBe(true);
    expect(await disconnected).toBe('io server disconnect');
  });
});
