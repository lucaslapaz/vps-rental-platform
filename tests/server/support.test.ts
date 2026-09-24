import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachSocketIo } from '../../src/server/realtime/socket.ts';
import type { ClientToServerEvents, SendMessageAck, ServerToClientEvents } from '../../src/shared/constants/events.ts';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { TestClient, uniqueEmail } from '../helpers/client.ts';

type ChatSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const { app, di, env } = createTestApp({ env: { SUPPORT_MAX_ACTIVE_PER_AGENT: 2 } });
const server = http.createServer(app);
const io = attachSocketIo(server, di);
const db = testPrisma();
const createdUsers: string[] = [];
const sockets: ChatSocket[] = [];
let url = '';

async function wipeSupport() {
  await db.supportMessage.deleteMany({});
  await db.supportConversation.deleteMany({});
}

beforeAll(async () => {
  await wipeSupport(); // banco de TESTE: a fila começa vazia
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  io.disconnectSockets(true);
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await wipeSupport();
  await db.session.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: createdUsers } } });
  await db.user.deleteMany({ where: { id: { in: createdUsers } } });
  await closeTestPrisma();
});

async function customer(name = 'Cliente Suporte') {
  const c = new TestClient(app);
  await c.init();
  const res = await c.send('post', '/api/auth/register', { name, email: uniqueEmail('suporte'), password: 'senha-forte-123' });
  createdUsers.push(res.body.user.id);
  return c;
}

async function agent(email: 'carla@favo.local' | 'diego@favo.local') {
  const c = new TestClient(app);
  await c.login(email);
  return c;
}

async function socketOf(c: TestClient) {
  const s: ChatSocket = connect(url, {
    transports: ['websocket'],
    extraHeaders: { Origin: env.APP_ORIGIN, Cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
    reconnection: false,
    forceNew: true,
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', reject);
  });
  return s;
}

const open = (c: TestClient, subject = 'VPS sem rede') =>
  c.send('post', '/api/support/conversations', { subject, message: 'Minha VPS não pinga.' });
const sendViaSocket = (s: ChatSocket, conversationId: string, body: string) =>
  new Promise<SendMessageAck>((resolve) => s.emit('support:message:send', { conversationId, body }, resolve));

describe('suporte: fila e atendimento', () => {
  it('o cliente abre uma conversa (entra na fila com posição) e não pode abrir outra', async () => {
    const c = await customer();
    const res = await open(c);
    expect(res.status).toBe(201);
    expect(res.body.conversation).toMatchObject({ status: 'WAITING', queuePosition: 1, agent: null, subject: 'VPS sem rede' });
    const again = await open(c, 'Outra');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CONVERSATION_ALREADY_OPEN');

    const second = await customer('Segundo');
    expect((await open(second)).body.conversation.queuePosition).toBe(2);
    const queue = (await (await agent('carla@favo.local')).get('/api/support/queue')).body.waiting;
    expect(queue.map((q: { customer: { name: string } }) => q.customer.name).slice(-2)).toEqual(['Cliente Suporte', 'Segundo']);
    expect(queue.at(-1)).toMatchObject({ preview: 'Minha VPS não pinga.' });
    await wipeSupport();
  });

  it('dois técnicos assumem ao mesmo tempo → exatamente 1 sucesso e 1 ALREADY_CLAIMED', async () => {
    const c = await customer();
    const conv = (await open(c)).body.conversation;
    const [carla, diego] = await Promise.all([agent('carla@favo.local'), agent('diego@favo.local')]);
    const results = await Promise.all([
      carla.send('post', `/api/support/conversations/${conv.id}/claim`),
      diego.send('post', `/api/support/conversations/${conv.id}/claim`),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe('ALREADY_CLAIMED');
    const row = await db.supportConversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(row.status).toBe('ACTIVE');
    // O cliente vê quem assumiu; a mensagem de sistema leva o nome do técnico (traduzida na tela).
    const mine = (await c.get('/api/support/conversations/current')).body.conversation;
    expect(mine.agent.name).toMatch(/Carla|Diego/);
    const msgs = (await c.get(`/api/support/conversations/${conv.id}/messages`)).body.messages;
    expect(msgs.map((m: { system: string | null }) => m.system)).toEqual([null, 'queued', 'claimed']);
    await wipeSupport();
  });

  it('limite de atendimentos simultâneos por técnico → 409 AGENT_LIMIT', async () => {
    const carla = await agent('carla@favo.local');
    for (let i = 0; i < 2; i++) {
      const conv = (await open(await customer())).body.conversation;
      expect((await carla.send('post', `/api/support/conversations/${conv.id}/claim`)).status).toBe(200);
    }
    const third = (await open(await customer())).body.conversation;
    const res = await carla.send('post', `/api/support/conversations/${third.id}/claim`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AGENT_LIMIT');
    expect((await carla.get('/api/support/my-conversations')).body.conversations).toHaveLength(2);
    await wipeSupport();
  });

  it('permissões: técnico não acessa VPS nem faturas; cliente não vê a fila; não participante recebe 404', async () => {
    const carla = await agent('carla@favo.local');
    expect((await carla.get('/api/vps')).status).toBe(403);
    expect((await carla.get('/api/invoices')).status).toBe(403);
    const c = await customer();
    expect((await c.get('/api/support/queue')).status).toBe(403);
    expect((await c.send('post', '/api/support/conversations/00000000-0000-4000-8000-000000000000/claim')).status).toBe(403);

    const conv = (await open(c)).body.conversation;
    const intruder = await customer('Intruso');
    expect((await intruder.get(`/api/support/conversations/${conv.id}/messages`)).status).toBe(404);
    expect((await intruder.send('post', `/api/support/conversations/${conv.id}/close`)).status).toBe(404);
    // Técnico que não assumiu também não lê as mensagens (só a prévia da fila).
    expect((await carla.get(`/api/support/conversations/${conv.id}/messages`)).status).toBe(404);
    await wipeSupport();
  });

  it('devolver à fila e encerrar; conversa encerrada não aceita mensagens', async () => {
    const c = await customer();
    const conv = (await open(c)).body.conversation;
    const carla = await agent('carla@favo.local');
    await carla.send('post', `/api/support/conversations/${conv.id}/claim`);
    const released = await carla.send('post', `/api/support/conversations/${conv.id}/release`);
    expect(released.body.conversation).toMatchObject({ status: 'WAITING', agent: null, queuePosition: 1 });
    expect((await carla.send('post', `/api/support/conversations/${conv.id}/release`)).status).toBe(404);

    const closed = await c.send('post', `/api/support/conversations/${conv.id}/close`);
    expect(closed.body.conversation.status).toBe('CLOSED');
    const late = await c.send('post', `/api/support/conversations/${conv.id}/messages`, { body: 'oi?' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('CONVERSATION_CLOSED');
    // Depois de encerrar, pode abrir outra.
    expect((await open(c, 'Nova dúvida')).status).toBe(201);
    await wipeSupport();
  });
});

describe('suporte: tempo real (Socket.IO)', () => {
  it('fila ao vivo para os técnicos, chat com ack nos dois sentidos e "digitando…"', async () => {
    const carla = await agent('carla@favo.local');
    const agentSocket = await socketOf(carla);
    const queueUpdate = new Promise<{ waiting: { id: string }[] }>((resolve) => agentSocket.once('support:queue:updated', resolve));

    const c = await customer('Cliente Tempo Real');
    const customerSocket = await socketOf(c);
    const conv = (await open(c)).body.conversation;
    expect((await queueUpdate).waiting.map((w) => w.id)).toContain(conv.id);

    const claimedEvent = new Promise<{ status: string; agent: { name: string } | null }>((resolve) =>
      customerSocket.once('support:conversation:updated', resolve),
    );
    await carla.send('post', `/api/support/conversations/${conv.id}/claim`);
    expect(await claimedEvent).toMatchObject({ status: 'ACTIVE', agent: { name: 'Carla Mendes' } });

    // Cliente → técnico
    const atAgent = new Promise<{ body: string; sender: { role: string } | null }>((resolve) => {
      agentSocket.on('support:message:new', (m) => {
        if (m.sender) resolve(m);
      });
    });
    const ack = await sendViaSocket(customerSocket, conv.id, '  Olá, preciso de ajuda  ');
    expect(ack).toMatchObject({ ok: true, message: { body: 'Olá, preciso de ajuda', sender: { role: 'customer' } } });
    expect(await atAgent).toMatchObject({ body: 'Olá, preciso de ajuda', sender: { role: 'customer' } });

    // Técnico → cliente, e "digitando…"
    const typing = new Promise<{ userName: string }>((resolve) => customerSocket.once('support:typing', resolve));
    agentSocket.emit('support:typing', { conversationId: conv.id });
    expect((await typing).userName).toBe('Carla Mendes');
    const atCustomer = new Promise<{ body: string }>((resolve) =>
      customerSocket.on('support:message:new', (m) => {
        if (m.sender?.role === 'agent') resolve(m);
      }),
    );
    expect((await sendViaSocket(agentSocket, conv.id, 'Vou verificar.')).ok).toBe(true);
    expect((await atCustomer).body).toBe('Vou verificar.');

    // Mensagem vazia e conversa de outra pessoa: recusadas pelo ack.
    expect(await sendViaSocket(customerSocket, conv.id, '   ')).toEqual({ ok: false, code: 'VALIDATION_ERROR' });
    const intruder = await socketOf(await customer('Intruso Socket'));
    expect(await sendViaSocket(intruder, conv.id, 'posso entrar?')).toEqual({ ok: false, code: 'NOT_FOUND' });

    // Rajada: no máximo 20 mensagens a cada 10 s por socket (revisão de segurança, Fase 9).
    const burst = await Promise.all(Array.from({ length: 21 }, (_, i) => sendViaSocket(customerSocket, conv.id, `rajada ${i}`)));
    expect(burst.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code))).toContain('RATE_LIMITED');

    // Reconexão: busca só o que veio depois do último id recebido.
    const all = (await c.get(`/api/support/conversations/${conv.id}/messages`)).body.messages as { id: number }[];
    const afterFirst = (await c.get(`/api/support/conversations/${conv.id}/messages?after=${all[0]?.id}`)).body.messages;
    expect(afterFirst).toHaveLength(all.length - 1);
  });
});
