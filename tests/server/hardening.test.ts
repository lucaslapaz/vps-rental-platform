import { afterAll, describe, expect, it } from 'vitest';
import { JobQueue } from '../../src/server/jobs/JobQueue.ts';
import { JobWorker } from '../../src/server/jobs/JobWorker.ts';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { TestClient, uniqueEmail } from '../helpers/client.ts';

const db = testPrisma();
const createdUsers: string[] = [];

afterAll(async () => {
  const ids = (await db.vps.findMany({ where: { userId: { in: createdUsers } }, select: { id: true } })).map((v) => v.id);
  await db.job.deleteMany({});
  await db.payment.deleteMany({ where: { invoice: { userId: { in: createdUsers } } } });
  await db.invoice.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.vpsEvent.deleteMany({ where: { vpsId: { in: ids } } });
  await db.vps.deleteMany({ where: { id: { in: ids } } });
  await db.ipAddress.updateMany({ where: { status: { not: 'FREE' }, vps: null }, data: { status: 'FREE' } });
  await db.session.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: createdUsers } } });
  await db.user.deleteMany({ where: { id: { in: createdUsers } } });
  await closeTestPrisma();
});

describe('limites de tentativas (plano §9.3)', () => {
  // Nos testes os limites ficam desligados (NODE_ENV=test); aqui a app finge ser dev para exercitá-los de verdade.
  const { app } = createTestApp({ env: { NODE_ENV: 'development' } });

  it('login: 5 tentativas por e-mail em 15 min; a 6ª recebe 429 RATE_LIMITED mesmo com a senha certa', async () => {
    const c = new TestClient(app);
    await c.init();
    const email = uniqueEmail('limite');
    const reg = await c.send('post', '/api/auth/register', { name: 'Limite', email, password: 'senha-forte-123' });
    createdUsers.push(reg.body.user.id);

    const attacker = new TestClient(app);
    await attacker.init();
    for (let i = 0; i < 5; i++) {
      expect((await attacker.send('post', '/api/auth/login', { email, password: `errada-${i}-xxxx` })).status).toBe(401);
    }
    const blocked = await attacker.send('post', '/api/auth/login', { email, password: 'senha-forte-123' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers.ratelimit ?? blocked.headers['ratelimit-policy']).toBeDefined();
  });
});

describe('robustez do worker e do provisionamento', () => {
  const { app, di, virtualization } = createTestApp({
    env: {
      CAPACITY_MAX_MEMORY_MB: 1_000_000,
      CAPACITY_MAX_DISK_GB: 100_000,
      MAX_VPS_PER_USER: 20,
      VPS_WAIT_SSH: false,
      WORKER_POLL_MS: 100,
    },
  });
  virtualization.memAvailableMb = 64 * 1024;

  async function paidOrder(hostname: string) {
    const c = new TestClient(app);
    await c.init();
    const reg = await c.send('post', '/api/auth/register', {
      name: 'Robustez',
      email: uniqueEmail('robusto'),
      password: 'senha-forte-123',
    });
    createdUsers.push(reg.body.user.id);
    const created = await c.send('post', '/api/vps', {
      osTemplate: 'alpine-3.24',
      plan: 'nano',
      hostname,
      username: 'lucas',
      password: 'senha-da-vps-123',
    });
    const card = {
      cardNumber: '4242424242424242',
      holder: 'Cliente Teste',
      expMonth: 12,
      expYear: new Date().getFullYear() + 2,
      cvc: '123',
    };
    expect((await c.send('post', `/api/invoices/${created.body.invoice.id}/pay`, card)).status).toBe(200);
    return created.body.vps.id as string;
  }

  it('VMID já usado por outra VPS no banco → o job reserva o próximo (índice único como trava)', async () => {
    await db.job.deleteMany({});
    const first = await paidOrder('vmid-a');
    await di.resolve(JobWorker).drain();
    const vmidA = (await db.vps.findUniqueOrThrow({ where: { id: first } })).pveVmid as number;
    // O Proxmox "esquece" a VM (ex.: apagada à mão): ele devolveria o mesmo VMID, que ainda consta no banco.
    virtualization.vms.delete(vmidA);
    const second = await paidOrder('vmid-b');
    await di.resolve(JobWorker).drain();
    const b = await db.vps.findUniqueOrThrow({ where: { id: second } });
    expect(b.status).toBe('RUNNING');
    expect(b.pveVmid).toBe(vmidA + 1);
  });

  it('start() devolve à fila jobs presos de uma execução anterior, processa com o timer e agenda o reconcile; stop() para', async () => {
    await db.job.deleteMany({});
    const worker = di.resolve(JobWorker);
    const queue = di.resolve(JobQueue);
    const id = await paidOrder('timer-a');
    // Simula o processo anterior que morreu com o job RUNNING (mesmo prefixo de worker, outro pid).
    const [stuck] = await queue.claim(`${worker.workerId.split('#')[0]}#1`, 1);
    expect(stuck?.type).toBe('provision_vps');

    await worker.start();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const v = await db.vps.findUniqueOrThrow({ where: { id } });
      if (v.status === 'RUNNING') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await worker.stop();
    expect((await db.vps.findUniqueOrThrow({ where: { id } })).status).toBe('RUNNING');
    // O agendador enfileirou os periódicos.
    const types = (await db.job.findMany({ select: { type: true } })).map((j) => j.type);
    expect(types).toEqual(expect.arrayContaining(['reconcile', 'expire_pending', 'cleanup_sessions']));
  });
});
