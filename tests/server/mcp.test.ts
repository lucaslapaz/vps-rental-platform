import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFavoMcpServer } from '../../scripts/mcp/favoMcp.ts';
import { PlatformInspector } from '../../scripts/pve/inspect.ts';
import { loadEnv } from '../../src/server/config/env.ts';
import { closeTestPrisma, testPrisma } from '../helpers/app.ts';
import { FakeVirtualizationProvider } from '../helpers/FakeVirtualizationProvider.ts';

/** MCP da Favo (plano §16.3, Fase 10): cliente e servidor em memória, com o provider falso e o banco de teste. */
const env = loadEnv();
const db = testPrisma();
const fake = new FakeVirtualizationProvider();
const UPID = 'UPID:primeiro:00000B84:000098B2:6AB512D1:qmstart:2001:vpsplatform@pve!backend:';
const requested: string[] = [];
// Só GET: o inspetor recebe um cliente da API sem nenhum método que altere algo.
const api = {
  get: async (path: string) => {
    requested.push(path);
    return path.endsWith('/status') ? { type: 'qmstart', status: 'stopped', exitstatus: 'OK' } : [{ n: 1, t: 'TASK OK' }];
  },
} as unknown as ConstructorParameters<typeof PlatformInspector>[2];

const client = new Client({ name: 'teste', version: '1.0.0' });
const text = (r: Awaited<ReturnType<typeof client.callTool>>) => (r.content as { text: string }[])[0]?.text ?? '';
const call = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

beforeAll(async () => {
  await fake.cloneFromTemplate({ templateVmid: 9000, vmid: 4242, name: 'vm-sem-dono', description: '' });
  const server = createFavoMcpServer(new PlatformInspector(env, fake, api, db));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client.close();
  await closeTestPrisma();
});

describe('MCP da Favo (somente leitura)', () => {
  it('expõe só as 5 ferramentas do plano, todas marcadas como somente leitura', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'platform_reconcile_report',
      'pve_capacity',
      'pve_instance_status',
      'pve_list_instances',
      'pve_task_log',
    ]);
    for (const t of tools) expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it('capacidade, instâncias, estado e relatório de reconciliação', async () => {
    expect(JSON.parse(text(await call('pve_capacity')))).toMatchObject({ node: env.PVE_NODE, memTotalBytes: expect.any(Number) });
    const list = JSON.parse(text(await call('pve_list_instances')));
    expect(list).toContainEqual(expect.objectContaining({ vmid: 4242, name: 'vm-sem-dono', vps: null }));
    expect(JSON.parse(text(await call('pve_instance_status', { vmid: 4242 })))).toMatchObject({ vmid: 4242, pending: [] });
    const report = JSON.parse(text(await call('platform_reconcile_report')));
    expect(report.orphanVmids).toContain(4242);
  });

  it('recusa entradas inválidas sem chamar o Proxmox: VM inexistente, VMID fora da faixa, UPID malformado', async () => {
    const missing = await call('pve_instance_status', { vmid: 999_999 });
    expect(missing.isError).toBe(true);
    expect((await call('pve_instance_status', { vmid: -1 })).isError).toBe(true);
    const bad = await call('pve_task_log', { upid: '../../access/users' });
    expect(bad.isError).toBe(true);
    expect(requested).toEqual([]);

    const task = JSON.parse(text(await call('pve_task_log', { upid: UPID, limit: 5 })));
    expect(task).toEqual({ status: { type: 'qmstart', status: 'stopped', exitstatus: 'OK' }, log: ['TASK OK'] });
    expect(requested.every((p) => p.startsWith(`/nodes/${env.PVE_NODE}/tasks/UPID%3A`))).toBe(true);
  });
});
