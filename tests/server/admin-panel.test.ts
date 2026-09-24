import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobQueue } from '../../src/server/jobs/JobQueue.ts';
import { JobWorker } from '../../src/server/jobs/JobWorker.ts';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { TestClient, uniqueEmail } from '../helpers/client.ts';

/** Painel admin ampliado (plano §17, Fase 10): visão geral, fila de jobs, todas as VPS e o editor de roles. */
const { app, di } = createTestApp({
  env: { CAPACITY_MAX_MEMORY_MB: 1_000_000, CAPACITY_MAX_DISK_GB: 100_000, MAX_VPS_PER_USER: 20, VPS_WAIT_SSH: false },
});
const db = testPrisma();
const worker = di.resolve(JobWorker);
const queue = di.resolve(JobQueue);
const createdUsers: string[] = [];
const ROLE_PREFIX = 'teste_painel_';

let admin: TestClient;
let customer: TestClient;
let customerId = '';
let vpsId = '';

beforeAll(async () => {
  await db.job.deleteMany({});
  admin = new TestClient(app);
  await admin.login('admin@favo.local');
  customer = new TestClient(app);
  await customer.init();
  const email = uniqueEmail('painel');
  const reg = await customer.send('post', '/api/auth/register', { name: 'Cliente do Painel', email, password: 'senha-forte-123' });
  customerId = reg.body.user.id;
  createdUsers.push(customerId);
  const created = await customer.send('post', '/api/vps', {
    osTemplate: 'alpine-3.24',
    plan: 'nano',
    hostname: 'painel-vps',
    username: 'lucas',
    password: 'senha-da-vps-123',
  });
  vpsId = created.body.vps.id;
  const card = { cardNumber: '4242424242424242', holder: 'Cliente', expMonth: 12, expYear: new Date().getFullYear() + 2, cvc: '123' };
  await customer.send('post', `/api/invoices/${created.body.invoice.id}/pay`, card);
  await worker.drain();
});

afterAll(async () => {
  const vps = await db.vps.findMany({ where: { userId: { in: createdUsers } }, select: { id: true } });
  const ids = vps.map((v) => v.id);
  await db.job.deleteMany({});
  await db.payment.deleteMany({ where: { invoice: { userId: { in: createdUsers } } } });
  await db.invoice.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.vpsEvent.deleteMany({ where: { vpsId: { in: ids } } });
  await db.vps.deleteMany({ where: { id: { in: ids } } });
  await db.ipAddress.updateMany({ where: { status: { not: 'FREE' }, vps: null }, data: { status: 'FREE' } });
  const customerRole = await db.role.findUniqueOrThrow({ where: { key: 'customer' } });
  await db.user.updateMany({ where: { id: { in: createdUsers } }, data: { roleId: customerRole.id } });
  const roles = await db.role.findMany({ where: { key: { startsWith: ROLE_PREFIX } }, select: { id: true } });
  await db.rolePermission.deleteMany({ where: { roleId: { in: roles.map((r) => r.id) } } });
  await db.role.deleteMany({ where: { id: { in: roles.map((r) => r.id) } } });
  await closeTestPrisma();
});

describe('visão geral e fila de jobs', () => {
  it('admin vê capacidade do nó, alocação, contagens e jobs; cliente e técnico levam 403', async () => {
    const res = await admin.get('/api/admin/overview');
    expect(res.status).toBe(200);
    const o = res.body.overview;
    expect(o.node).toMatchObject({ pveVersion: expect.any(String), memTotalBytes: expect.any(Number) });
    expect(o.allocation.memoryMb).toBeGreaterThanOrEqual(256);
    expect(o.users.find((u: { role: string }) => u.role === 'admin')?.count).toBeGreaterThanOrEqual(1);
    expect(o.vps.find((v: { status: string }) => v.status === 'RUNNING')?.count).toBeGreaterThanOrEqual(1);
    expect(o.jobs.find((j: { status: string }) => j.status === 'SUCCEEDED')?.count).toBeGreaterThanOrEqual(1);

    expect((await customer.get('/api/admin/overview')).status).toBe(403);
    const tech = new TestClient(app);
    await tech.login('carla@favo.local');
    expect((await tech.get('/api/admin/overview')).status).toBe(403);
    expect((await tech.get('/api/admin/vps')).status).toBe(403);
  });

  it('jobs trazem a VPS, mas nunca o payload (que pode ter senhas cifradas)', async () => {
    const res = await admin.get('/api/admin/jobs?status=SUCCEEDED');
    expect(res.status).toBe(200);
    const provision = res.body.jobs.find(
      (j: { type: string; vps: { id: string } | null }) => j.type === 'provision_vps' && j.vps?.id === vpsId,
    );
    expect(provision).toMatchObject({ status: 'SUCCEEDED', vps: { hostname: 'painel-vps' } });
    expect(JSON.stringify(res.body)).not.toContain('payload');
    expect(JSON.stringify(res.body)).not.toContain('secrets');
    expect((await admin.get('/api/admin/jobs?status=QUALQUER')).status).toBe(400);
  });

  it('a lista esconde os periódicos (reconcile, billing_cycle…) a não ser que peça; a limpeza apaga as falhas antigas deles', async () => {
    await queue.enqueue('reconcile', {}, { maxAttempts: 1 });
    await worker.drain();
    const types = async (qs: string) => ((await admin.get(`/api/admin/jobs${qs}`)).body.jobs as { type: string }[]).map((j) => j.type);
    expect(await types('')).not.toContain('reconcile');
    expect(await types('?periodic=true')).toContain('reconcile');

    // Falha de periódico com mais de 1 dia (ex.: Proxmox fora do ar) sai na limpeza; a recente fica para investigar.
    const old = await db.job.create({ data: { type: 'reconcile', payload: {}, status: 'FAILED', lastError: 'fetch failed' } });
    const recent = await db.job.create({ data: { type: 'reconcile', payload: {}, status: 'FAILED', lastError: 'fetch failed' } });
    await db.$executeRaw`UPDATE jobs SET updatedAt = ${new Date(Date.now() - 2 * 86_400_000)} WHERE id = ${old.id}`;
    await queue.enqueue('cleanup_sessions', {}, { maxAttempts: 1 });
    await worker.drain();
    expect(await db.job.count({ where: { id: old.id } })).toBe(0);
    expect(await db.job.count({ where: { id: recent.id } })).toBe(1);
  });

  it('todas as VPS (somente leitura), com o dono, e busca por e-mail', async () => {
    const all = await admin.get('/api/admin/vps');
    expect(all.status).toBe(200);
    const mine = all.body.vps.find((v: { id: string }) => v.id === vpsId);
    expect(mine).toMatchObject({ hostname: 'painel-vps', status: 'RUNNING', owner: { id: customerId }, plan: 'Nano' });
    const email = mine.owner.email as string;
    const found = await admin.get(`/api/admin/vps?query=${encodeURIComponent(email)}`);
    expect(found.body.vps.map((v: { id: string }) => v.id)).toEqual([vpsId]);
    // Somente leitura: o admin não tem vps:*:own, então não abre console nem executa ações na VPS de um cliente.
    expect((await admin.send('post', `/api/vps/${vpsId}/console`)).status).toBe(403);
    expect((await admin.send('post', `/api/vps/${vpsId}/actions/stop`)).status).toBe(403);
  });
});

describe('editor de roles', () => {
  const key = `${ROLE_PREFIX}${Date.now().toString(36)}`;

  it('cria uma role, atribui a um usuário e as permissões valem na hora (sem novo login)', async () => {
    const created = await admin.send('post', '/api/admin/roles', {
      key,
      name: 'Auditor de VPS',
      description: 'Só enxerga as VPS',
      permissions: ['account:manage:own', 'admin:vps:read', 'admin:vps:read'],
    });
    expect(created.status).toBe(201);
    expect(created.body.role).toMatchObject({ key, isSystem: false, permissions: ['account:manage:own', 'admin:vps:read'], userCount: 0 });
    expect((await admin.send('post', '/api/admin/roles', { key, name: 'De novo', permissions: [] })).status).toBe(409);
    expect((await admin.send('post', '/api/admin/roles', { key: 'Com Espaço', name: 'X', permissions: [] })).status).toBe(400);
    expect((await admin.send('post', '/api/admin/roles', { key: `${key}x`, name: 'X', permissions: ['vps:tudo'] })).status).toBe(400);

    const auditor = new TestClient(app);
    await auditor.init();
    const reg = await auditor.send('post', '/api/auth/register', {
      name: 'Auditor',
      email: uniqueEmail('auditor'),
      password: 'senha-forte-123',
    });
    createdUsers.push(reg.body.user.id);
    expect((await admin.send('patch', `/api/admin/users/${reg.body.user.id}/role`, { role: key })).status).toBe(200);
    await auditor.login(reg.body.user.email, 'senha-forte-123');
    expect((await auditor.get('/api/admin/vps')).status).toBe(200);
    expect((await auditor.get('/api/admin/overview')).status).toBe(403);

    // Editar a role muda o acesso de quem já está logado, na próxima requisição.
    const updated = await admin.send('put', `/api/admin/roles/${key}`, {
      name: 'Auditor geral',
      permissions: ['account:manage:own', 'admin:vps:read', 'admin:overview:read'],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.role).toMatchObject({ name: 'Auditor geral', userCount: 1 });
    expect((await auditor.get('/api/admin/overview')).status).toBe(200);

    // Em uso não pode ser apagada.
    const inUse = await admin.send('delete', `/api/admin/roles/${key}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('ROLE_IN_USE');
    expect(await db.auditLog.count({ where: { targetId: key, action: { startsWith: 'admin.role_' } } })).toBe(2);
  });

  it('roles do sistema são só leitura (vêm do código); cliente não edita roles', async () => {
    const res = await admin.send('put', '/api/admin/roles/customer', { name: 'Cliente', permissions: [] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SYSTEM_ROLE_READONLY');
    expect((await admin.send('delete', '/api/admin/roles/admin')).status).toBe(409);
    expect((await customer.send('post', '/api/admin/roles', { key: `${ROLE_PREFIX}c`, name: 'Cliente', permissions: [] })).status).toBe(
      403,
    );
  });

  it('role sem usuários é apagada', async () => {
    const tmp = `${ROLE_PREFIX}tmp${Date.now().toString(36)}`;
    expect((await admin.send('post', '/api/admin/roles', { key: tmp, name: 'Temporária', permissions: [] })).status).toBe(201);
    expect((await admin.send('delete', `/api/admin/roles/${tmp}`)).status).toBe(204);
    expect(await db.role.count({ where: { key: tmp } })).toBe(0);
    expect((await admin.send('delete', `/api/admin/roles/${tmp}`)).status).toBe(404);
  });
});
