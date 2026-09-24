import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOKENS } from '../../src/server/container/tokens.ts';
import { PermanentJobError } from '../../src/server/jobs/handlers/types.ts';
import { JobQueue } from '../../src/server/jobs/JobQueue.ts';
import { JobWorker } from '../../src/server/jobs/JobWorker.ts';
import type { RealtimeHub } from '../../src/server/realtime/RealtimeEmitter.ts';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { generateSshPublicKey, TestClient, uniqueEmail } from '../helpers/client.ts';

const {
  app,
  di,
  virtualization: fake,
} = createTestApp({
  env: { CAPACITY_MAX_MEMORY_MB: 1_000_000, CAPACITY_MAX_DISK_GB: 100_000, MAX_VPS_PER_USER: 20, VPS_WAIT_SSH: false },
});
const db = testPrisma();
const worker = di.resolve(JobWorker);
const queue = di.resolve(JobQueue);
const hub = di.resolve<RealtimeHub>(TOKENS.Realtime);
const createdUsers: string[] = [];

beforeAll(async () => {
  // Banco de TESTE: jobs de execuções anteriores não podem ser processados aqui.
  await db.job.deleteMany({});
});

afterAll(async () => {
  const vps = await db.vps.findMany({ where: { userId: { in: createdUsers } }, select: { id: true, ipAddressId: true } });
  const vpsIds = vps.map((v) => v.id);
  const ipIds = vps.map((v) => v.ipAddressId).filter((id): id is number => id !== null);
  await db.job.deleteMany({});
  await db.payment.deleteMany({ where: { invoice: { userId: { in: createdUsers } } } });
  await db.invoice.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.vpsEvent.deleteMany({ where: { vpsId: { in: vpsIds } } });
  await db.vps.deleteMany({ where: { id: { in: vpsIds } } });
  await db.ipAddress.updateMany({ where: { id: { in: ipIds } }, data: { status: 'FREE' } });
  await db.ipAddress.updateMany({ where: { status: { not: 'FREE' }, vps: null }, data: { status: 'FREE' } });
  await closeTestPrisma();
});

async function customer() {
  const c = new TestClient(app);
  await c.init();
  const res = await c.send('post', '/api/auth/register', { name: 'Cliente Jobs', email: uniqueEmail('jobs'), password: 'senha-forte-123' });
  createdUsers.push(res.body.user.id);
  return c;
}

const card = {
  cardNumber: '4242 4242 4242 4242',
  holder: 'Cliente Teste',
  expMonth: 12,
  expYear: new Date().getFullYear() + 2,
  cvc: '123',
};

/** Pedido + pagamento aprovado: a VPS fica em PROVISIONING com o job provision_vps na fila. */
async function paidVps(c: TestClient, over: Record<string, unknown> = {}) {
  const created = await c.send('post', '/api/vps', {
    osTemplate: 'alpine-3.24',
    plan: 'nano',
    hostname: 'vps-jobs',
    username: 'lucas',
    password: 'senha-da-vps-123',
    rootPassword: 'senha-do-root-123',
    sshPasswordAuth: true,
    newSshKey: { publicKey: generateSshPublicKey() },
    ...over,
  });
  expect(created.status).toBe(201);
  const paid = await c.send('post', `/api/invoices/${created.body.invoice.id}/pay`, card);
  expect(paid.status).toBe(200);
  return created.body.vps.id as string;
}

const vpsRow = (id: string) => db.vps.findUniqueOrThrow({ where: { id }, include: { ipAddress: true } });
const provisionJob = (vpsId: string) =>
  db.job.findFirstOrThrow({ where: { type: 'provision_vps', payload: { path: '$.vpsId', equals: vpsId } } });

describe('provision_vps', () => {
  it('pagamento → RUNNING: IP ASSIGNED, VM configurada, senha root, política de SSH e segredos apagados', async () => {
    const c = await customer();
    const id = await paidVps(c);
    await worker.drain();

    const vps = await vpsRow(id);
    expect(vps.status).toBe('RUNNING');
    expect(vps.ipAddress?.status).toBe('ASSIGNED');
    const vm = fake.vms.get(vps.pveVmid as number);
    expect(vm).toMatchObject({ status: 'running', diskGb: 2, sshPasswordAuth: true, passwords: { root: 'senha-do-root-123' } });
    expect(vm?.cloudInit).toMatchObject({ user: 'lucas', password: 'senha-da-vps-123', ip: vps.ipAddress?.address });
    expect(vm?.spec).toEqual({ cores: 1, memoryMb: 256, bandwidthMbps: 10 });
    // Anti-spoofing (Fase 10): o firewall da VM recebe o IP dela antes de ligar.
    expect(fake.calls).toContain(`applyNetworkFirewall:${vps.pveVmid}:${vps.ipAddress?.address}`);
    expect(fake.calls.indexOf(`applyNetworkFirewall:${vps.pveVmid}:${vps.ipAddress?.address}`)).toBeLessThan(
      fake.calls.indexOf(`power:${vps.pveVmid}:start`),
    );

    const job = await provisionJob(id);
    expect(job.status).toBe('SUCCEEDED');
    expect((job.payload as Record<string, unknown>).secrets).toBeNull();

    // Linha do tempo gravada e emitida para a sala do dono.
    const steps = (await db.vpsEvent.findMany({ where: { vpsId: id, action: 'provision' }, orderBy: { id: 'asc' } })).map((e) => e.message);
    expect(steps).toEqual(['ip', 'cloning', 'configuring', 'starting', 'booting', 'access', 'ready']);
    const owner = vps.userId;
    expect(
      hub.sent.some(
        (s) => s.room === `user:${owner}` && s.event === 'vps:status' && (s.args[0] as { status: string }).status === 'RUNNING',
      ),
    ).toBe(true);
  });

  it('espera o cloud-init; conta só com chave é liberada para o SSH (Alpine sem PAM), com senha não', async () => {
    const c = await customer();
    const keyOnly = await paidVps(c, { hostname: 'so-chave', password: undefined, sshPasswordAuth: false });
    const withPassword = await paidVps(c, { hostname: 'com-senha' });
    await worker.drain();
    const a = (await vpsRow(keyOnly)).pveVmid;
    const b = (await vpsRow(withPassword)).pveVmid;
    expect(fake.calls).toContain(`waitForCloudInit:${a}`);
    expect(fake.calls).toContain(`allowKeyLogin:${a}:lucas`);
    expect(fake.calls).not.toContain(`allowKeyLogin:${b}:lucas`);
    // A espera pelo cloud-init vem antes do pós-boot.
    expect(fake.calls.indexOf(`waitForCloudInit:${a}`)).toBeLessThan(fake.calls.indexOf(`allowKeyLogin:${a}:lucas`));
  });

  it('falha no meio → nova tentativa retoma do checkpoint sem clonar de novo', async () => {
    const c = await customer();
    const id = await paidVps(c);
    fake.failNext('power');
    await worker.drain();

    let job = await provisionJob(id);
    expect(job).toMatchObject({ status: 'QUEUED', attempts: 1 });
    expect((await vpsRow(id)).status).toBe('PROVISIONING');

    await db.job.update({ where: { id: job.id }, data: { runAt: new Date() } }); // pula o backoff
    await worker.drain();
    job = await provisionJob(id);
    const vps = await vpsRow(id);
    expect(job.status).toBe('SUCCEEDED');
    expect(vps.status).toBe('RUNNING');
    expect(fake.calls.filter((call) => call === `clone:${vps.pveVmid}`)).toHaveLength(1);
  });

  it('processo morreu com o job RUNNING → releaseStale devolve à fila e o job termina', async () => {
    const c = await customer();
    const id = await paidVps(c);
    const [claimed] = await queue.claim(`${worker.workerId.split('#')[0]}#99999`, 1); // "worker anterior" que morreu
    expect(claimed?.type).toBe('provision_vps');
    expect(await queue.releaseStale(`${worker.workerId.split('#')[0]}#`)).toBe(1);
    await worker.drain();
    expect((await vpsRow(id)).status).toBe('RUNNING');
  });

  it('falha definitiva depois do clone → VM apagada, IP FREE, VPS ERROR com código', async () => {
    const c = await customer();
    const id = await paidVps(c);
    fake.failNext('power', new PermanentJobError('boom'));
    await worker.drain();

    const vps = await vpsRow(id);
    expect(vps).toMatchObject({ status: 'ERROR', lastError: 'PROVISION_FAILED', pveVmid: null, ipAddressId: null });
    const job = await provisionJob(id);
    expect(job.status).toBe('FAILED');
    expect((job.payload as Record<string, unknown>).secrets).toBeNull();
    const destroyed = fake.calls.filter((call) => call.startsWith('destroy:'));
    expect(destroyed.length).toBeGreaterThan(0);
    const res = await c.get(`/api/vps/${id}`);
    expect(res.body.vps).toMatchObject({ status: 'ERROR', lastError: 'PROVISION_FAILED' });
  });
});

describe('ações, troca de plano e exclusão', () => {
  it('shutdown → STOPPING (202) → STOPPED; ação concorrente → 409 VPS_BUSY; start em RUNNING → 409', async () => {
    const c = await customer();
    const id = await paidVps(c);
    await worker.drain();

    expect((await c.send('post', `/api/vps/${id}/actions/start`)).body.error.code).toBe('VPS_INVALID_STATE');
    const res = await c.send('post', `/api/vps/${id}/actions/shutdown`);
    expect(res.status).toBe(202);
    expect(res.body.vps.status).toBe('STOPPING');
    const busy = await c.send('post', `/api/vps/${id}/actions/reboot`);
    expect(busy.status).toBe(409);
    expect(busy.body.error.code).toBe('VPS_BUSY');

    await worker.drain();
    expect((await vpsRow(id)).status).toBe('STOPPED');
    expect((await c.send('post', `/api/vps/${id}/actions/start`)).status).toBe(202);
    await worker.drain();
    expect((await vpsRow(id)).status).toBe('RUNNING');
  });

  it('ação desconhecida → 400; VPS de outro cliente → 404', async () => {
    const c = await customer();
    const id = await paidVps(c);
    await worker.drain();
    expect((await c.send('post', `/api/vps/${id}/actions/explodir`)).status).toBe(400);
    const other = await customer();
    expect((await other.send('post', `/api/vps/${id}/actions/shutdown`)).status).toBe(404);
    expect((await other.send('delete', `/api/vps/${id}`)).status).toBe(404);
  });

  it('troca de plano: nano → micro aplica na VM e gera a fatura proporcional; diminuir o disco → 422', async () => {
    const c = await customer();
    const id = await paidVps(c);
    await worker.drain();

    const res = await c.send('post', `/api/vps/${id}/resize`, { plan: 'micro' });
    expect(res.status).toBe(202);
    expect(res.body.vps.status).toBe('UPDATING');
    await worker.drain();

    const vps = await vpsRow(id);
    expect(vps).toMatchObject({ status: 'RUNNING', memoryMb: 512, diskGb: 4, bandwidthMbps: 25 });
    expect(fake.vms.get(vps.pveVmid as number)).toMatchObject({ diskGb: 4, spec: { cores: 1, memoryMb: 512, bandwidthMbps: 25 } });
    const invoice = await db.invoice.findFirstOrThrow({ where: { vpsId: id, status: 'PENDING' } });
    expect(invoice.amountCents).toBeGreaterThan(990);
    expect(invoice.amountCents).toBeLessThanOrEqual(1000);

    const shrink = await c.send('post', `/api/vps/${id}/resize`, { plan: 'nano' });
    expect(shrink.status).toBe(422);
    expect(shrink.body.error.code).toBe('DISK_SHRINK_NOT_SUPPORTED');
  });

  it('exclusão: DELETING → DELETED, VM apagada, IP FREE, faturas em aberto canceladas', async () => {
    const c = await customer();
    const id = await paidVps(c);
    await worker.drain();
    const before = await vpsRow(id);

    const res = await c.send('delete', `/api/vps/${id}`);
    expect(res.status).toBe(202);
    expect(res.body.vps.status).toBe('DELETING');
    await worker.drain();

    const after = await vpsRow(id);
    expect(after).toMatchObject({ status: 'DELETED', pveVmid: null, ipAddressId: null });
    expect(after.deletedAt).not.toBeNull();
    expect(fake.vms.has(before.pveVmid as number)).toBe(false);
    expect((await db.ipAddress.findUniqueOrThrow({ where: { id: before.ipAddressId as number } })).status).toBe('FREE');
    expect((await c.get('/api/vps')).body.vps.some((v: { id: string }) => v.id === id)).toBe(false);
  });

  it('exclusão aguardando pagamento é imediata e cancela a fatura', async () => {
    const c = await customer();
    const created = await c.send('post', '/api/vps', {
      osTemplate: 'alpine-3.24',
      plan: 'nano',
      hostname: 'sem-pagar',
      username: 'lucas',
      password: 'senha-da-vps-123',
    });
    const res = await c.send('delete', `/api/vps/${created.body.vps.id}`);
    expect(res.status).toBe(202);
    expect(res.body.vps.status).toBe('DELETED');
    expect((await db.invoice.findUniqueOrThrow({ where: { id: created.body.invoice.id } })).status).toBe('CANCELED');
  });
});

describe('jobs periódicos', () => {
  it('reconcile: VM desligada pela interface do Proxmox → STOPPED; VM sumiu → ERROR VM_MISSING', async () => {
    const c = await customer();
    const a = await paidVps(c, { hostname: 'recon-a' });
    const b = await paidVps(c, { hostname: 'recon-b' });
    await worker.drain();

    const vmA = fake.vms.get((await vpsRow(a)).pveVmid as number);
    if (vmA) vmA.status = 'stopped';
    fake.vms.delete((await vpsRow(b)).pveVmid as number);

    await queue.enqueue('reconcile', {}, { maxAttempts: 1 });
    await worker.drain();
    expect((await vpsRow(a)).status).toBe('STOPPED');
    expect(await vpsRow(b)).toMatchObject({ status: 'ERROR', lastError: 'VM_MISSING' });
  });

  it('expire_pending: fatura vencida é cancelada e a VPS que aguardava pagamento vira DELETED', async () => {
    const c = await customer();
    const created = await c.send('post', '/api/vps', {
      osTemplate: 'alpine-3.24',
      plan: 'nano',
      hostname: 'venceu',
      username: 'lucas',
      password: 'senha-da-vps-123',
    });
    await db.invoice.update({ where: { id: created.body.invoice.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await queue.enqueue('expire_pending', {}, { maxAttempts: 1 });
    await worker.drain();
    expect((await db.invoice.findUniqueOrThrow({ where: { id: created.body.invoice.id } })).status).toBe('CANCELED');
    expect(await db.vps.findUniqueOrThrow({ where: { id: created.body.vps.id } })).toMatchObject({
      status: 'DELETED',
      provisionSecrets: null,
    });
  });
});
