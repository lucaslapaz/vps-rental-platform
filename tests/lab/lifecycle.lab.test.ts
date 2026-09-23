/**
 * @lab — roteiro E2E da Fase 7 contra o laboratório de verdade (plano §17): o app inteiro (HTTP, fila, worker, proxy do
 * console) com o QemuCloudInitProvider e o TOKEN da plataforma. Pedido → pagamento → RUNNING → SSH → desligar → ligar →
 * reiniciar → aumentar o plano (disco cresce online; memória no reinício) → renomear → console (handshake VNC real) →
 * excluir. Usa o IP .229 (reservado para testes): o pool do banco de teste fica só com ele durante o roteiro, para não
 * colidir com as VPS do banco de desenvolvimento na mesma rede. Rode com `npm run test:lab`.
 */
import 'reflect-metadata';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { container } from 'tsyringe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../../src/server/app.ts';
import { loadEnv } from '../../src/server/config/env.ts';
import { registerDependencies } from '../../src/server/container/register.ts';
import { TOKENS } from '../../src/server/container/tokens.ts';
import type { VirtualizationProvider } from '../../src/server/integrations/virtualization/VirtualizationProvider.ts';
import { JobWorker } from '../../src/server/jobs/JobWorker.ts';
import { attachConsoleProxy } from '../../src/server/realtime/consoleProxy.ts';
import { macFromIp } from '../../src/server/utils/ipv4.ts';
import { createLogger } from '../../src/server/utils/logger.ts';
import { closeTestPrisma, testPrisma } from '../helpers/app.ts';
import { TestClient, uniqueEmail } from '../helpers/client.ts';
import { LAB_IP, myPublicKey, sshKey } from './helpers.ts';

const env = { ...loadEnv(), VPS_WAIT_SSH: true, CAPACITY_MAX_MEMORY_MB: 4096, CAPACITY_MAX_DISK_GB: 100 };
const db = testPrisma();
const di = registerDependencies({ env, logger: createLogger(env), prisma: db }, container.createChildContainer());
const app = createApp(di);
const server = http.createServer(app);
const proxy = attachConsoleProxy(server, di);
const worker = di.resolve(JobWorker);
const vms = di.resolve<VirtualizationProvider>(TOKENS.VirtualizationProvider);

const client = new TestClient(app);
let userId = '';
let vpsId = '';
let vmid = 0;
let heldIps: number[] = [];
let labIpId = 0;

/** Depois de ligar/reiniciar, o sshd sobe alguns segundos depois de a VM estar "running". */
async function sshReady(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = sshKey('cliente', 'true');
    if (r.code === 0) return;
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('SSH não respondeu a tempo');
}

const vps = () => db.vps.findUniqueOrThrow({ where: { id: vpsId } });
async function act(method: 'post' | 'delete' | 'patch', path: string, body?: object) {
  const res = await client.send(method, path, body);
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  await worker.drain();
  return res;
}

beforeAll(async () => {
  await db.job.deleteMany({});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Só o .229 disponível no pool do banco de TESTE durante o roteiro.
  const free = await db.ipAddress.findMany({ where: { status: 'FREE' }, select: { id: true } });
  heldIps = free.map((i) => i.id);
  await db.ipAddress.updateMany({ where: { id: { in: heldIps } }, data: { status: 'RESERVED' } });
  const lab = await db.ipAddress.upsert({
    where: { address: LAB_IP },
    create: { address: LAB_IP, prefix: 24, gateway: '192.168.56.10', macAddress: macFromIp(LAB_IP), status: 'FREE' },
    update: { status: 'FREE' },
  });
  labIpId = lab.id;
  // Uma execução interrompida pode ter deixado uma VPS presa ao .229 (índice único em ipAddressId).
  await db.vps.updateMany({ where: { ipAddressId: labIpId }, data: { ipAddressId: null, status: 'DELETED', deletedAt: new Date() } });
  await client.init();
  const reg = await client.send('post', '/api/auth/register', {
    name: 'Roteiro Lab',
    email: uniqueEmail('lab'),
    password: 'senha-forte-123',
  });
  userId = reg.body.user.id;
});

afterAll(async () => {
  // Se algo falhou no meio, não deixa VM para trás.
  if (vmid && (await vms.exists(vmid).catch(() => false))) await vms.destroy(vmid).catch(() => undefined);
  proxy.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const ids = (await db.vps.findMany({ where: { userId }, select: { id: true } })).map((v) => v.id);
  await db.job.deleteMany({});
  await db.payment.deleteMany({ where: { invoice: { userId } } });
  await db.invoice.deleteMany({ where: { userId } });
  await db.vpsEvent.deleteMany({ where: { vpsId: { in: ids } } });
  await db.vps.deleteMany({ where: { id: { in: ids } } });
  await db.ipAddress.delete({ where: { id: labIpId } }).catch(() => undefined);
  await db.ipAddress.updateMany({ where: { id: { in: heldIps } }, data: { status: 'FREE' } });
  await closeTestPrisma();
}, 240_000);

describe('@lab roteiro E2E da VPS (Fase 7)', () => {
  it('pedido → pagamento → RUNNING, e o SSH com a chave funciona na hora', async () => {
    const created = await client.send('post', '/api/vps', {
      osTemplate: 'alpine-3.24',
      plan: 'nano',
      hostname: 'favo-roteiro',
      username: 'cliente',
      newSshKey: { publicKey: myPublicKey() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    vpsId = created.body.vps.id;
    const card = { cardNumber: '4242424242424242', holder: 'Lab', expMonth: 12, expYear: new Date().getFullYear() + 2, cvc: '123' };
    expect((await client.send('post', `/api/invoices/${created.body.invoice.id}/pay`, card)).status).toBe(200);
    await worker.drain();
    const v = await vps();
    expect(v.status).toBe('RUNNING');
    vmid = v.pveVmid as number;
    expect(sshKey('cliente', 'hostname').out).toBe('favo-roteiro');
    // O cloud-init foi congelado no fim do provisionamento (C23).
    expect(sshKey('cliente', 'test -e /etc/cloud/cloud-init.disabled && echo congelado').out).toBe('congelado');
  }, 300_000);

  it('desligar → STOPPED; ligar → RUNNING; reiniciar → RUNNING', async () => {
    await act('post', `/api/vps/${vpsId}/actions/shutdown`);
    expect((await vps()).status).toBe('STOPPED');
    expect((await vms.status(vmid))?.status).toBe('stopped');
    await act('post', `/api/vps/${vpsId}/actions/start`);
    expect((await vps()).status).toBe('RUNNING');
    await act('post', `/api/vps/${vpsId}/actions/reboot`);
    expect((await vps()).status).toBe('RUNNING');
  }, 300_000);

  it('aumentar o plano: o disco cresce com a VM ligada; a memória vale depois do reinício pelo painel', async () => {
    await sshReady();
    const hostKey = sshKey('cliente', 'cat /etc/ssh/ssh_host_ed25519_key.pub').out;
    await act('post', `/api/vps/${vpsId}/resize`, { plan: 'micro' });
    expect(await vps()).toMatchObject({ status: 'RUNNING', memoryMb: 512, diskGb: 4, diskGrowPending: false });
    const rootKb = Number(sshKey('cliente', "df -k / | awk 'NR==2 {print $2}'").out);
    expect(rootKb).toBeGreaterThan(3 * 1024 * 1024);
    const live = (await client.get(`/api/vps/${vpsId}/live`)).body.live;
    expect(live.pendingReboot).toBe(true);

    await act('post', `/api/vps/${vpsId}/actions/reboot`);
    await sshReady();
    const memKb = Number(sshKey('cliente', "awk '/MemTotal/ {print $2}' /proc/meminfo").out);
    expect(memKb).toBeGreaterThan(400 * 1024);
    // Reiniciar não regenerou as chaves de host (o cloud-init está congelado).
    expect(sshKey('cliente', 'cat /etc/ssh/ssh_host_ed25519_key.pub').out).toBe(hostKey);
  }, 300_000);

  it('renomear muda o hostname dentro da VM na hora', async () => {
    const res = await client.send('patch', `/api/vps/${vpsId}`, { hostname: 'favo-renomeada' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(sshKey('cliente', 'hostname').out).toBe('favo-renomeada');
  }, 120_000);

  it('console: o proxy entrega o handshake VNC do Proxmox ("RFB 003.00x")', async () => {
    const { consoleId } = (await client.send('post', `/api/vps/${vpsId}/console`)).body;
    const port = (server.address() as AddressInfo).port;
    const cookie = [...client.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const banner = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/console/${consoleId}`, ['binary'], {
        headers: { Origin: env.APP_ORIGIN, Cookie: cookie },
      });
      ws.once('message', (data) => {
        resolve(Buffer.from(data as Buffer).toString('latin1'));
        ws.close();
      });
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, r) => reject(new Error(`HTTP ${r.statusCode}`)));
    });
    expect(banner).toMatch(/^RFB 003\.00\d\n$/);
  }, 60_000);

  it('excluir → DELETED, VM apagada no Proxmox e IP de volta ao pool', async () => {
    await act('delete', `/api/vps/${vpsId}`);
    expect(await vps()).toMatchObject({ status: 'DELETED', pveVmid: null });
    expect(await vms.exists(vmid)).toBe(false);
    expect((await db.ipAddress.findUniqueOrThrow({ where: { id: labIpId } })).status).toBe('FREE');
    vmid = 0;
  }, 300_000);
});
