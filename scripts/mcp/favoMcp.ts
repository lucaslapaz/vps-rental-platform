import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PlatformInspector } from '../pve/inspect.ts';

/** Todas as ferramentas só leem: o cliente de IA pode chamá-las sem pedir confirmação para alterar nada. */
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

/**
 * MCP da Favo (plano §16.3, Fase 10): expõe a agentes de IA as mesmas consultas do CLI `npm run pve`, SOMENTE LEITURA e
 * com o token da plataforma (restrito aos pools `vps-platform`/`vps-templates`). Nada aqui liga, desliga, cria ou apaga.
 */
export function createFavoMcpServer(inspector: PlatformInspector) {
  const server = new McpServer({ name: 'favo-pve', version: '1.0.0' });

  server.registerTool(
    'pve_capacity',
    {
      title: 'Capacidade do nó Proxmox',
      description: 'Memória (total, usada, disponível), storage e CPUs do nó do laboratório, e a versão do Proxmox.',
      annotations: readOnly,
    },
    async () => json(await inspector.capacity()),
  );

  server.registerTool(
    'pve_list_instances',
    {
      title: 'VMs da plataforma',
      description: 'Lista as VMs do pool da plataforma com estado, memória, disco e a VPS da Favo a que cada uma pertence.',
      annotations: readOnly,
    },
    async () => json(await inspector.instances()),
  );

  server.registerTool(
    'pve_instance_status',
    {
      title: 'Estado de uma VM',
      description: 'Estado atual de uma VM pelo VMID, com as alterações de CPU/RAM pendentes (valem no próximo reinício).',
      inputSchema: { vmid: z.number().int().min(100).max(999_999_999).describe('VMID da VM (as VPS começam em 2000)') },
      annotations: readOnly,
    },
    async ({ vmid }) => {
      const found = await inspector.instance(vmid);
      if (!found) return { ...json({ error: `A VM ${vmid} não existe ou está fora dos pools do token.` }), isError: true };
      return json(found);
    },
  );

  server.registerTool(
    'pve_task_log',
    {
      title: 'Log de uma task',
      description: 'Estado e últimas linhas do log de uma task do Proxmox (clone, start, shutdown…), pelo UPID.',
      inputSchema: {
        upid: z.string().max(200).describe('UPID completo da task, ex.: UPID:<nó>:…:qmstart:2000:…:'),
        limit: z.number().int().min(1).max(500).default(50).describe('Quantas linhas do log trazer'),
      },
      annotations: readOnly,
    },
    async ({ upid, limit }) => {
      try {
        return json(await inspector.task(upid, limit));
      } catch (err) {
        return { ...json({ error: (err as Error).message }), isError: true };
      }
    },
  );

  server.registerTool(
    'platform_reconcile_report',
    {
      title: 'Relatório de reconciliação',
      description: 'Compara o pool do Proxmox com o banco da Favo: VMs órfãs (sem VPS) e VPS sem VM. Só o relatório; não corrige nada.',
      annotations: readOnly,
    },
    async () => json(await inspector.reconcileReport()),
  );

  return server;
}
