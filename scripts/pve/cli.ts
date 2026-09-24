/**
 * CLI de desenvolvimento do Proxmox (plano §16.3): reutiliza o ProxmoxClient e o provider do backend, com o TOKEN da
 * plataforma (restrito aos pools). Serve de ferramenta e de teste do código real de integração.
 *
 *   npm run pve -- status | capacity | list | show <vmid> | task <upid> | reconcile --dry-run
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { loadEnv } from '../../src/server/config/env.ts';
import { registerDependencies } from '../../src/server/container/register.ts';
import { TOKENS } from '../../src/server/container/tokens.ts';
import { createPrismaClient } from '../../src/server/db/prisma.ts';
import { ProxmoxClient } from '../../src/server/integrations/proxmox/ProxmoxClient.ts';
import type { VirtualizationProvider } from '../../src/server/integrations/virtualization/VirtualizationProvider.ts';
import { createLogger } from '../../src/server/utils/logger.ts';
import { PlatformInspector } from './inspect.ts';

const env = loadEnv();
const prisma = createPrismaClient({ url: env.DATABASE_URL, poolLimit: 2 });
const di = registerDependencies({ env, logger: createLogger({ ...env, LOG_LEVEL: 'warn' }), prisma }, container.createChildContainer());
const provider = di.resolve<VirtualizationProvider>(TOKENS.VirtualizationProvider);
const client = di.resolve(ProxmoxClient);
const inspector = new PlatformInspector(env, provider, client, prisma);

const GiB = 1024 ** 3;
const gib = (b: number) => `${(b / GiB).toFixed(2)} GiB`;
const pct = (used: number, total: number) => `${((used / total) * 100).toFixed(0)}%`;

async function capacity() {
  const c = await inspector.capacity();
  console.log(`Proxmox ${c.pveVersion} · nó ${c.node} · ${c.cpuCount} vCPU`);
  console.log(
    `RAM      ${gib(c.memUsedBytes)} / ${gib(c.memTotalBytes)} (${pct(c.memUsedBytes, c.memTotalBytes)})  livre ${gib(c.memFreeBytes)}  disponível ${gib(c.memAvailableBytes)}`,
  );
  console.log(
    `Storage  ${gib(c.storageUsedBytes)} / ${gib(c.storageTotalBytes)} (${pct(c.storageUsedBytes, c.storageTotalBytes)})  livre ${gib(c.storageAvailBytes)}  [${env.PVE_STORAGE}]`,
  );
}

async function list() {
  const list = await inspector.instances();
  if (!list.length) return console.log(`Nenhuma VM no pool ${env.PVE_POOL}.`);
  for (const s of list) {
    console.log(
      `${String(s.vmid).padEnd(6)} ${(s.name ?? '?').padEnd(28)} ${s.status.padEnd(8)} RAM ${gib(s.memMaxBytes)}  disco ${gib(s.diskMaxBytes)}`,
    );
  }
}

async function show(vmid: number) {
  const s = await inspector.instance(vmid);
  if (!s) return console.log(`VM ${vmid} não existe (ou está fora dos pools do token).`);
  console.log(JSON.stringify(s, null, 2));
}

async function task(upid: string) {
  const t = await inspector.task(upid);
  console.log(JSON.stringify(t.status, null, 2));
  for (const l of t.log) console.log(`  ${l}`);
}

/** Compara o pool do Proxmox com a tabela `vps` (só o relatório; a correção automática é o job reconcile). */
async function reconcile() {
  const r = await inspector.reconcileReport();
  console.log(`Pool ${r.pool}: ${r.vmsInPool} VM(s) · banco: ${r.vpsWithVmid} VPS com VMID`);
  console.log(r.orphanVmids.length ? `Órfãs no Proxmox (sem VPS no banco): ${r.orphanVmids.join(', ')}` : 'Nenhuma VM órfã.');
  console.log(
    r.vpsWithoutVm.length
      ? `VPS sem VM no Proxmox: ${r.vpsWithoutVm.map((m) => `${m.hostname} (${m.pveVmid}, ${m.status})`).join(', ')}`
      : 'Nenhuma VPS sem VM.',
  );
  console.log('(dry-run: nada foi alterado)');
}

const [command, arg] = process.argv.slice(2);
try {
  switch (command) {
    case 'status':
      console.log(`API: ${(await provider.ping()) ? 'ok' : 'FORA DO AR'} · ${env.PVE_URL} · token ${env.PVE_TOKEN_ID}`);
      await capacity();
      break;
    case 'capacity':
      await capacity();
      break;
    case 'list':
      await list();
      break;
    case 'show':
      await show(Number(arg));
      break;
    case 'task':
      if (!arg) throw new Error('uso: npm run pve -- task <upid>');
      await task(arg);
      break;
    case 'reconcile':
      await reconcile();
      break;
    default:
      console.log('uso: npm run pve -- status | capacity | list | show <vmid> | task <upid> | reconcile --dry-run');
      process.exitCode = command ? 2 : 0;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await client.close();
}
