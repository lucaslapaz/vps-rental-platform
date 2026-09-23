/**
 * CLI de desenvolvimento do Proxmox (plano §16.3): reutiliza o ProxmoxClient e o provider do backend, com o TOKEN da
 * plataforma (restrito aos pools). Serve de ferramenta e de teste do código real de integração.
 *
 *   npm run pve -- status | capacity | list | show <vmid> | task <upid> | reconcile --dry-run
 */
import 'reflect-metadata';
import { container } from 'tsyringe';
import { z } from 'zod';
import { loadEnv } from '../../src/server/config/env.ts';
import { registerDependencies } from '../../src/server/container/register.ts';
import { TOKENS } from '../../src/server/container/tokens.ts';
import { createPrismaClient } from '../../src/server/db/prisma.ts';
import { ProxmoxClient } from '../../src/server/integrations/proxmox/ProxmoxClient.ts';
import type { VirtualizationProvider } from '../../src/server/integrations/virtualization/VirtualizationProvider.ts';
import { createLogger } from '../../src/server/utils/logger.ts';

const env = loadEnv();
const prisma = createPrismaClient({ url: env.DATABASE_URL, poolLimit: 2 });
const di = registerDependencies({ env, logger: createLogger({ ...env, LOG_LEVEL: 'warn' }), prisma }, container.createChildContainer());
const provider = di.resolve<VirtualizationProvider>(TOKENS.VirtualizationProvider);
const client = di.resolve(ProxmoxClient);

const GiB = 1024 ** 3;
const gib = (b: number) => `${(b / GiB).toFixed(2)} GiB`;
const pct = (used: number, total: number) => `${((used / total) * 100).toFixed(0)}%`;

async function capacity() {
  const c = await provider.capacity();
  console.log(`Proxmox ${c.pveVersion} · nó ${env.PVE_NODE} · ${c.cpuCount} vCPU`);
  console.log(
    `RAM      ${gib(c.memUsedBytes)} / ${gib(c.memTotalBytes)} (${pct(c.memUsedBytes, c.memTotalBytes)})  livre ${gib(c.memFreeBytes)}`,
  );
  console.log(
    `Storage  ${gib(c.storageUsedBytes)} / ${gib(c.storageTotalBytes)} (${pct(c.storageUsedBytes, c.storageTotalBytes)})  livre ${gib(c.storageAvailBytes)}  [${env.PVE_STORAGE}]`,
  );
}

async function list() {
  const vmids = await provider.listManagedVmids();
  if (!vmids.length) return console.log(`Nenhuma VM no pool ${env.PVE_POOL}.`);
  for (const vmid of vmids.sort((a, b) => a - b)) {
    const s = await provider.status(vmid);
    console.log(
      `${String(vmid).padEnd(6)} ${(s?.name ?? '?').padEnd(28)} ${(s?.status ?? '?').padEnd(8)} RAM ${gib(s?.memMaxBytes ?? 0)}  disco ${gib(s?.diskMaxBytes ?? 0)}`,
    );
  }
}

async function show(vmid: number) {
  const s = await provider.status(vmid);
  if (!s) return console.log(`VM ${vmid} não existe (ou está fora dos pools do token).`);
  console.log(JSON.stringify({ ...s, pending: await provider.pendingChanges(vmid) }, null, 2));
}

async function task(upid: string) {
  const path = `/nodes/${env.PVE_NODE}/tasks/${encodeURIComponent(upid)}`;
  console.log(JSON.stringify(await client.get(`${path}/status`, z.record(z.string(), z.unknown())), null, 2));
  const log = await client.get(`${path}/log`, z.array(z.object({ n: z.number(), t: z.string() })), { start: 0, limit: 50 });
  for (const l of log) console.log(`  ${l.t}`);
}

/** Compara o pool do Proxmox com a tabela `vps` (a reconciliação automática vem na Fase 6; aqui só o relatório). */
async function reconcile() {
  const inPool = new Set(await provider.listManagedVmids());
  const inDb = await prisma.vps.findMany({
    where: { pveVmid: { not: null }, deletedAt: null },
    select: { id: true, pveVmid: true, status: true },
  });
  const dbVmids = new Set(inDb.map((v) => v.pveVmid as number));
  const orphans = [...inPool].filter((v) => !dbVmids.has(v));
  const missing = inDb.filter((v) => !inPool.has(v.pveVmid as number));
  console.log(`Pool ${env.PVE_POOL}: ${inPool.size} VM(s) · banco: ${inDb.length} VPS com VMID`);
  console.log(orphans.length ? `Órfãs no Proxmox (sem VPS no banco): ${orphans.join(', ')}` : 'Nenhuma VM órfã.');
  console.log(
    missing.length
      ? `VPS sem VM no Proxmox: ${missing.map((m) => `${m.id} (${m.pveVmid}, ${m.status})`).join(', ')}`
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
