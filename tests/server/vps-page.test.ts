import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { JobWorker } from '../../src/server/jobs/JobWorker.ts';
import { attachConsoleProxy } from '../../src/server/realtime/consoleProxy.ts';
import { SessionService } from '../../src/server/services/SessionService.ts';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { generateSshPublicKey, TestClient, uniqueEmail } from '../helpers/client.ts';

const {
  app,
  di,
  env,
  virtualization: fake,
} = createTestApp({
  env: { CAPACITY_MAX_MEMORY_MB: 1_000_000, CAPACITY_MAX_DISK_GB: 100_000, MAX_VPS_PER_USER: 20, VPS_WAIT_SSH: false },
});
const db = testPrisma();
const worker = di.resolve(JobWorker);
const createdUsers: string[] = [];

// Servidor HTTP de verdade (para o upgrade do console) + um servidor WebSocket que faz o papel do VNC da VM (eco).
const server = http.createServer(app);
const proxy = attachConsoleProxy(server, di);
const vnc = new WebSocketServer({ port: 0, handleProtocols: () => 'binary' });
// Imita o termproxy: a linha "<user>:<ticket>\n" recebe "OK" + o prompt; o resto volta como eco (VNC e terminal).
const upstreamReceived: string[] = [];
vnc.on('connection', (ws) =>
  ws.on('message', (data, binary) => {
    const text = Buffer.from(data as Buffer).toString();
    upstreamReceived.push(text);
    if (text === 'fake@pve!token:term-ticket\n') ws.send(Buffer.from('OKlogin: '), { binary: true });
    else ws.send(data, { binary });
  }),
);
let base = '';

beforeAll(async () => {
  await db.job.deleteMany({});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.consoleUrl = `ws://127.0.0.1:${(vnc.address() as AddressInfo).port}`;
});

afterAll(async () => {
  proxy.close();
  vnc.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const vps = await db.vps.findMany({ where: { userId: { in: createdUsers } }, select: { id: true, ipAddressId: true } });
  const ids = vps.map((v) => v.id);
  await db.job.deleteMany({});
  await db.payment.deleteMany({ where: { invoice: { userId: { in: createdUsers } } } });
  await db.invoice.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.vpsEvent.deleteMany({ where: { vpsId: { in: ids } } });
  await db.vps.deleteMany({ where: { id: { in: ids } } });
  await db.ipAddress.updateMany({ where: { status: { not: 'FREE' }, vps: null }, data: { status: 'FREE' } });
  await closeTestPrisma();
});

async function customer() {
  const c = new TestClient(app);
  await c.init();
  const res = await c.send('post', '/api/auth/register', {
    name: 'Cliente Página',
    email: uniqueEmail('pagina'),
    password: 'senha-forte-123',
  });
  createdUsers.push(res.body.user.id);
  return c;
}

/** VPS já provisionada (RUNNING) no provider falso. */
async function runningVps(c: TestClient, over: Record<string, unknown> = {}) {
  const created = await c.send('post', '/api/vps', {
    osTemplate: 'alpine-3.24',
    plan: 'nano',
    hostname: 'pagina-vps',
    username: 'lucas',
    password: 'senha-da-vps-123',
    ...over,
  });
  expect(created.status).toBe(201);
  const card = { cardNumber: '4242424242424242', holder: 'Cliente', expMonth: 12, expYear: new Date().getFullYear() + 2, cvc: '123' };
  expect((await c.send('post', `/api/invoices/${created.body.invoice.id}/pay`, card)).status).toBe(200);
  await worker.drain();
  const vps = await db.vps.findUniqueOrThrow({ where: { id: created.body.vps.id } });
  expect(vps.status).toBe('RUNNING');
  return vps;
}

const cookieHeader = (c: TestClient) => [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ');

/** Abre o WebSocket do console e devolve o status do handshake (101 = aberto) ou o código HTTP de recusa. */
function openConsole(consoleId: string, headers: Record<string, string>) {
  return new Promise<{ status: number; ws?: WebSocket }>((resolve) => {
    const ws = new WebSocket(`ws://${base}/ws/console/${consoleId}`, ['binary'], { headers });
    ws.once('open', () => resolve({ status: 101, ws }));
    ws.once('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0 }));
    ws.once('error', () => resolve({ status: 0 }));
  });
}

describe('console (noVNC via proxy)', () => {
  it('sessão de uso único: abre, repassa frames nos dois sentidos e não pode ser reutilizada', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    const res = await c.send('post', `/api/vps/${vps.id}/console`);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ consoleId: expect.any(String), type: 'vnc', password: 'fake-password' });

    const headers = { Origin: env.APP_ORIGIN, Cookie: cookieHeader(c) };
    const opened = await openConsole(res.body.consoleId, headers);
    expect(opened.status).toBe(101);
    const echo = new Promise<Buffer>((resolve) => opened.ws?.once('message', (d) => resolve(d as Buffer)));
    opened.ws?.send(Buffer.from([1, 2, 3]));
    expect([...(await echo)]).toEqual([1, 2, 3]);
    opened.ws?.close();

    expect((await openConsole(res.body.consoleId, headers)).status).toBe(403); // reutilizado
  });

  it('terminal de texto: o proxy autentica no termproxy (o navegador não vê o ticket) e tira o "OK"', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    const res = await c.send('post', `/api/vps/${vps.id}/console`, { type: 'serial' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ consoleId: expect.any(String), type: 'serial' });

    const opened = await openConsole(res.body.consoleId, { Origin: env.APP_ORIGIN, Cookie: cookieHeader(c) });
    expect(opened.status).toBe(101);
    const first = await new Promise<string>((resolve) => opened.ws?.once('message', (d) => resolve(Buffer.from(d as Buffer).toString())));
    expect(first).toBe('login: ');
    expect(upstreamReceived).toContain('fake@pve!token:term-ticket\n');
    const echo = new Promise<string>((resolve) => opened.ws?.once('message', (d) => resolve(Buffer.from(d as Buffer).toString())));
    opened.ws?.send('0:2:ls');
    expect(await echo).toBe('0:2:ls');
    opened.ws?.close();
    expect((await c.send('post', `/api/vps/${vps.id}/console`, { type: 'telnet' })).status).toBe(400);
  });

  it('revogar a sessão (ex.: logout em outra aba) fecha o console aberto por ela', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    const { consoleId } = (await c.send('post', `/api/vps/${vps.id}/console`)).body;
    const opened = await openConsole(consoleId, { Origin: env.APP_ORIGIN, Cookie: cookieHeader(c) });
    expect(opened.status).toBe(101);
    const closed = new Promise<number>((resolve) => opened.ws?.once('close', (code) => resolve(code)));
    const me = (await c.get('/api/auth/me')).body.user;
    const current = (await c.get('/api/account/sessions')).body.sessions.find((x: { current: boolean }) => x.current);
    await di.resolve(SessionService).revoke(current.id, me.id);
    expect(await closed).toBe(4001);
  });

  it('recusa: outro usuário (403), sem sessão (401), origem de outro site (403) e técnico sem permissão (403)', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    const other = await customer();

    const a = (await c.send('post', `/api/vps/${vps.id}/console`)).body.consoleId;
    expect((await openConsole(a, { Origin: env.APP_ORIGIN, Cookie: cookieHeader(other) })).status).toBe(403);
    const b = (await c.send('post', `/api/vps/${vps.id}/console`)).body.consoleId;
    expect((await openConsole(b, { Origin: env.APP_ORIGIN })).status).toBe(401);
    const d = (await c.send('post', `/api/vps/${vps.id}/console`)).body.consoleId;
    expect((await openConsole(d, { Origin: 'https://evil.example', Cookie: cookieHeader(c) })).status).toBe(403);

    expect((await other.send('post', `/api/vps/${vps.id}/console`)).status).toBe(404);
    // Caminho inválido sob /ws/ → 404 imediato (antes, o upgrade ficava pendurado sem resposta).
    expect((await openConsole('undefined', { Origin: env.APP_ORIGIN, Cookie: cookieHeader(c) })).status).toBe(404);
    const tech = new TestClient(app);
    await tech.login('carla@favo.local');
    expect((await tech.send('post', `/api/vps/${vps.id}/console`)).status).toBe(403);
  });

  it('VPS desligada → 409 VPS_NOT_RUNNING; mais de 2 consoles → 429 CONSOLE_LIMIT', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    for (let i = 0; i < 2; i++) expect((await c.send('post', `/api/vps/${vps.id}/console`)).status).toBe(201);
    const third = await c.send('post', `/api/vps/${vps.id}/console`);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('CONSOLE_LIMIT');

    const other = await customer();
    const stopped = await runningVps(other, { hostname: 'desligada' });
    await other.send('post', `/api/vps/${stopped.id}/actions/stop`);
    await worker.drain();
    expect((await other.send('post', `/api/vps/${stopped.id}/console`)).body.error.code).toBe('VPS_NOT_RUNNING');
  });
});

describe('acesso pelo guest agent', () => {
  it('redefine a senha do usuário e do root, liga/desliga SSH por senha e adiciona chaves', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    const vm = () => fake.vms.get(vps.pveVmid as number);

    expect((await c.send('post', `/api/vps/${vps.id}/access/password`, { target: 'root', password: 'nova-senha-root-1' })).status).toBe(
      200,
    );
    expect(
      (await c.send('post', `/api/vps/${vps.id}/access/password`, { target: 'user', password: 'nova-senha-user-1' })).body.vps,
    ).toMatchObject({
      rootPasswordSet: true,
    });
    expect(vm()?.passwords).toMatchObject({ root: 'nova-senha-root-1', lucas: 'nova-senha-user-1' });
    expect((await c.send('post', `/api/vps/${vps.id}/access/password`, { target: 'user', password: 'curta' })).status).toBe(400);

    const off = await c.send('post', `/api/vps/${vps.id}/access/ssh-password-auth`, { enabled: false });
    expect(off.body.vps.sshPasswordAuth).toBe(false);
    expect(vm()?.sshPasswordAuth).toBe(false);

    const key = generateSshPublicKey('nova@favo');
    const added = await c.send('post', `/api/vps/${vps.id}/access/ssh-keys`, { publicKey: key, save: true, name: 'nova' });
    expect(added.status).toBe(200);
    expect(vm()?.authorizedKeys).toContain(key);
    const saved = (await c.get('/api/account/ssh-keys')).body.keys;
    expect(saved.map((k: { name: string }) => k.name)).toContain('nova');
    expect((await c.send('post', `/api/vps/${vps.id}/access/ssh-keys`, { publicKey: 'ssh-ed25519 AAAAinvalida' })).status).toBe(422);
    expect((await c.send('post', `/api/vps/${vps.id}/access/ssh-keys`, {})).status).toBe(400);

    const history = (await c.get(`/api/vps/${vps.id}/events`)).body.events.map((e: { action: string }) => e.action);
    expect(history).toEqual(expect.arrayContaining(['password', 'ssh_password_auth', 'ssh_key']));
    // A senha nunca vai para o histórico nem para a auditoria.
    const audit = await db.auditLog.findMany({ where: { targetId: vps.id } });
    expect(JSON.stringify(audit)).not.toContain('nova-senha');
  });

  it('renomear muda o nome da VM e o hostname dentro dela; desligada → 409', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    const res = await c.send('patch', `/api/vps/${vps.id}`, { hostname: 'novo-nome' });
    expect(res.status).toBe(200);
    expect(res.body.vps.hostname).toBe('novo-nome');
    expect(fake.vms.get(vps.pveVmid as number)).toMatchObject({ name: 'novo-nome', hostname: 'novo-nome' });
    expect((await c.send('patch', `/api/vps/${vps.id}`, { hostname: 'Nome_Invalido' })).status).toBe(400);

    await c.send('post', `/api/vps/${vps.id}/actions/shutdown`);
    await worker.drain();
    expect((await c.send('patch', `/api/vps/${vps.id}`, { hostname: 'outro' })).body.error.code).toBe('VPS_NOT_RUNNING');
  });
});

describe('estado ao vivo, métricas e disco', () => {
  it('o provisionamento congela o cloud-init; live e métricas respondem', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    expect(fake.vms.get(vps.pveVmid as number)?.cloudInitFrozen).toBe(true);

    const live = (await c.get(`/api/vps/${vps.id}/live`)).body.live;
    expect(live).toMatchObject({ power: 'running', cpus: 1, pendingReboot: false, disk: { usedBytes: expect.any(Number) } });
    const metrics = await c.get(`/api/vps/${vps.id}/metrics?timeframe=day`);
    expect(metrics.body.timeframe).toBe('day');
    expect(metrics.body.points.length).toBeGreaterThan(0);
    expect((await c.get(`/api/vps/${vps.id}/metrics?timeframe=ano`)).status).toBe(400);
  });

  it('disco aumentado com a VM desligada é expandido no próximo "Ligar"; ligada, na hora', async () => {
    const c = await customer();
    const vps = await runningVps(c);
    await c.send('post', `/api/vps/${vps.id}/actions/shutdown`);
    await worker.drain();
    await c.send('post', `/api/vps/${vps.id}/resize`, { plan: 'micro' });
    await worker.drain();
    expect((await db.vps.findUniqueOrThrow({ where: { id: vps.id } })).diskGrowPending).toBe(true);

    await c.send('post', `/api/vps/${vps.id}/actions/start`);
    await worker.drain();
    expect(await db.vps.findUniqueOrThrow({ where: { id: vps.id } })).toMatchObject({ status: 'RUNNING', diskGrowPending: false });
    expect(fake.vms.get(vps.pveVmid as number)?.rootFsGb).toBe(4);

    await c.send('post', `/api/vps/${vps.id}/resize`, { plan: 'small' });
    await worker.drain();
    expect(fake.vms.get(vps.pveVmid as number)?.rootFsGb).toBe(6);
    expect((await db.vps.findUniqueOrThrow({ where: { id: vps.id } })).diskGrowPending).toBe(false);
  });
});
