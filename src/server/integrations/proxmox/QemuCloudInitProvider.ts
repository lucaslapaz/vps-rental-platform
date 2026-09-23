import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import type {
  CloudInitSpec,
  ConsoleTicket,
  MetricPoint,
  MetricsTimeframe,
  NodeCapacity,
  PendingChange,
  PowerAction,
  VirtualizationProvider,
  VmSpec,
  VmStatus,
} from '../virtualization/VirtualizationProvider.ts';
import { imageProfile, sshdPolicy } from './ImageProfile.ts';
import { ProxmoxApiError, ProxmoxClient } from './ProxmoxClient.ts';
import { TaskWaiter } from './TaskWaiter.ts';

const upid = z.string();
const nothing = z.unknown();
const num = z.coerce.number();

const statusSchema = z.object({
  vmid: num,
  name: z.string().optional(),
  status: z.string(),
  uptime: num.optional(),
  cpu: num.optional(),
  cpus: num.optional(),
  mem: num.optional(),
  maxmem: num.optional(),
  maxdisk: num.optional(),
  netin: num.optional(),
  netout: num.optional(),
  agent: z.union([z.boolean(), num]).optional(),
  lock: z.string().optional(),
});

const execStatusSchema = z.object({
  exited: z.union([z.boolean(), num]),
  exitcode: num.optional(),
  'out-data': z.string().optional(),
  'err-data': z.string().optional(),
});

/** net[n].rate é em MB/s ("megabytes per second", CLAUDE.md A7): 10 Mbps = 1,25. */
export const mbpsToRate = (mbps: number) => Math.round((mbps / 8) * 1000) / 1000;
/** A API espera o sshkeys já URL-encoded (espaço = %20), uma chave por linha (CLAUDE.md C4, validado na Fase 0). */
export const encodeSshKeys = (keys: string[]) => encodeURIComponent(keys.map((k) => k.replace(/\r/g, '').trim()).join('\n'));

/**
 * Provider real: VMs KVM clonadas (linked clone) de templates cloud-init (plano §3.1, §10). Toda operação usa o token
 * da plataforma, que só enxerga os pools `vps-platform` e `vps-templates` (§3.4).
 */
@injectable()
export class QemuCloudInitProvider implements VirtualizationProvider {
  private readonly node: string;

  constructor(
    @inject(ProxmoxClient) private readonly pve: ProxmoxClient,
    @inject(TaskWaiter) private readonly tasks: TaskWaiter,
    @inject(TOKENS.Env) private readonly env: Env,
  ) {
    this.node = env.PVE_NODE;
  }

  private vm(vmid: number, suffix = '') {
    return `/nodes/${this.node}/qemu/${vmid}${suffix}`;
  }

  private net0(macAddress: string, bandwidthMbps: number) {
    return `virtio=${macAddress},bridge=${this.env.PVE_BRIDGE},rate=${mbpsToRate(bandwidthMbps)}`;
  }

  async ping() {
    try {
      await this.pve.get('/version', z.object({ version: z.string() }));
      return true;
    } catch {
      return false;
    }
  }

  async nextFreeVmid(start: number): Promise<number> {
    for (let vmid = start; vmid < start + 1000; vmid++) {
      // /cluster/nextid?vmid=N responde 200 se o VMID está livre e 400 se está em uso (inclusive VMs que o token não vê).
      try {
        await this.pve.get('/cluster/nextid', num, { vmid });
        return vmid;
      } catch (err) {
        if (!(err instanceof ProxmoxApiError) || err.status !== 400) throw err;
      }
    }
    throw new Error(`nenhum VMID livre a partir de ${start}`);
  }

  async exists(vmid: number) {
    return (await this.status(vmid)) !== null;
  }

  async cloneFromTemplate({
    templateVmid,
    vmid,
    name,
    description,
  }: {
    templateVmid: number;
    vmid: number;
    name: string;
    description: string;
  }) {
    const task = await this.pve.post(this.vm(templateVmid, '/clone'), upid, {
      newid: vmid,
      name,
      description,
      pool: this.env.PVE_POOL,
      full: false, // linked clone: segundos, e só ocupa o que difere do template
    });
    await this.tasks.wait(task, { timeoutMs: 180_000 });
  }

  async configure(vmid: number, spec: VmSpec, ci: CloudInitSpec, extra: { tags?: string[] } = {}) {
    await this.pve.put(this.vm(vmid, '/config'), nothing, {
      cores: spec.cores,
      memory: spec.memoryMb,
      net0: this.net0(ci.macAddress, spec.bandwidthMbps),
      ciuser: ci.user,
      cipassword: ci.password,
      sshkeys: ci.sshKeys.length ? encodeSshKeys(ci.sshKeys) : undefined,
      ipconfig0: `ip=${ci.ip}/${ci.prefix},gw=${ci.gateway}`,
      nameserver: ci.nameservers.join(' '),
      ciupgrade: false, // o template já sai atualizado; o upgrade no 1º boot levava minutos (CLAUDE.md C1)
      onboot: true,
      tags: extra.tags?.join(';'),
    });
  }

  async updateResources(vmid: number, spec: VmSpec, macAddress: string) {
    await this.pve.put(this.vm(vmid, '/config'), nothing, {
      cores: spec.cores,
      memory: spec.memoryMb,
      net0: this.net0(macAddress, spec.bandwidthMbps),
    });
  }

  async rename(vmid: number, name: string) {
    await this.pve.put(this.vm(vmid, '/config'), nothing, { name });
  }

  async resizeDisk(vmid: number, sizeGb: number) {
    // Tamanho absoluto; diminuir não é suportado (CLAUDE.md A8), então o chamador só pede aumento.
    await this.tasks.wait(await this.pve.put(this.vm(vmid, '/resize'), nothing, { disk: 'scsi0', size: `${sizeGb}G` }));
  }

  async power(vmid: number, action: PowerAction) {
    const params = action === 'shutdown' ? { timeout: 60, forceStop: true } : action === 'reboot' ? { timeout: 60 } : undefined;
    await this.tasks.wait(await this.pve.post(this.vm(vmid, `/status/${action}`), upid, params), { timeoutMs: 120_000 });
  }

  async status(vmid: number): Promise<VmStatus | null> {
    try {
      const s = await this.pve.get(this.vm(vmid, '/status/current'), statusSchema);
      return {
        vmid,
        name: s.name ?? '',
        status: s.status === 'running' || s.status === 'stopped' || s.status === 'paused' ? s.status : 'unknown',
        uptimeSeconds: s.uptime ?? 0,
        cpu: s.cpu ?? 0,
        cpus: s.cpus ?? 0,
        memUsedBytes: s.mem ?? 0,
        memMaxBytes: s.maxmem ?? 0,
        diskMaxBytes: s.maxdisk ?? 0,
        netInBytes: s.netin ?? 0,
        netOutBytes: s.netout ?? 0,
        agentEnabled: Boolean(s.agent),
        ...(s.lock ? { lock: s.lock } : {}),
      };
    } catch (err) {
      // VM inexistente → 500 "does not exist"; fora dos pools do token → 403. Para a plataforma, as duas são "não existe".
      if (err instanceof ProxmoxApiError && (err.status === 403 || /does not exist/i.test(err.message))) return null;
      throw err;
    }
  }

  async pendingChanges(vmid: number): Promise<PendingChange[]> {
    const items = await this.pve.get(
      this.vm(vmid, '/pending'),
      z.array(z.object({ key: z.string(), value: z.unknown().optional(), pending: z.unknown().optional(), delete: num.optional() })),
    );
    return items
      .filter((i) => i.pending !== undefined || i.delete)
      .map((i) => ({
        key: i.key,
        value: i.value as string | number | undefined,
        pending: i.pending as string | number | undefined,
        delete: i.delete,
      }));
  }

  async destroy(vmid: number) {
    const current = await this.status(vmid);
    if (!current) return; // idempotente: já não existe
    if (current.status === 'running') await this.power(vmid, 'stop');
    await this.tasks.wait(await this.pve.delete(this.vm(vmid), upid, { purge: true, 'destroy-unreferenced-disks': true }), {
      timeoutMs: 180_000,
    });
  }

  async metrics(vmid: number, timeframe: MetricsTimeframe): Promise<MetricPoint[]> {
    const rows = await this.pve.get(this.vm(vmid, '/rrddata'), z.array(z.record(z.string(), z.unknown())), { timeframe, cf: 'AVERAGE' });
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return rows.map((r) => ({
      time: Number(r.time),
      cpu: n(r.cpu),
      memUsed: n(r.mem),
      memMax: n(r.maxmem),
      netIn: n(r.netin),
      netOut: n(r.netout),
      diskRead: n(r.diskread),
      diskWrite: n(r.diskwrite),
    }));
  }

  async listManagedVmids() {
    const pools = await this.pve.get(
      '/pools',
      z.array(z.object({ poolid: z.string(), members: z.array(z.object({ vmid: num.optional(), type: z.string() })).optional() })),
      { poolid: this.env.PVE_POOL }, // GET /pools/{poolid} está deprecated no PVE 9 (CLAUDE.md A2)
    );
    return (pools[0]?.members ?? []).filter((m) => m.type === 'qemu' && m.vmid !== undefined).map((m) => m.vmid as number);
  }

  async capacity(): Promise<NodeCapacity> {
    const node = await this.pve.get(
      `/nodes/${this.node}/status`,
      z.object({
        memory: z.object({ total: num, used: num, free: num }),
        cpuinfo: z.object({ cpus: num }),
        pveversion: z.string(),
      }),
    );
    const storage = await this.pve.get(
      `/nodes/${this.node}/storage/${this.env.PVE_STORAGE}/status`,
      z.object({ total: num, used: num, avail: num }),
    );
    return {
      memTotalBytes: node.memory.total,
      memUsedBytes: node.memory.used,
      memFreeBytes: node.memory.free,
      storageTotalBytes: storage.total,
      storageUsedBytes: storage.used,
      storageAvailBytes: storage.avail,
      cpuCount: node.cpuinfo.cpus,
      pveVersion: node.pveversion,
    };
  }

  // ───────────── Guest agent (plano §10.6) ─────────────

  async agentPing(vmid: number) {
    try {
      await this.pve.post(this.vm(vmid, '/agent/ping'), nothing);
      return true;
    } catch (err) {
      if (err instanceof ProxmoxApiError) return false; // 500 "QEMU guest agent is not running" enquanto a VM boota
      throw err;
    }
  }

  async waitForAgent(vmid: number, timeoutMs = 240_000) {
    const started = Date.now();
    while (!(await this.agentPing(vmid))) {
      if (Date.now() - started > timeoutMs) throw new Error(`guest agent da VM ${vmid} não respondeu em ${Math.round(timeoutMs / 1000)} s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  async setUserPassword(vmid: number, username: string, password: string) {
    await this.pve.post(this.vm(vmid, '/agent/set-user-password'), nothing, { username, password });
  }

  /** Executa um comando FIXO pelo agente e espera terminar. Nunca recebe texto do usuário no comando (§10.6). */
  private async exec(vmid: number, command: readonly string[], inputData?: string, timeoutMs = 30_000, okCodes: readonly number[] = [0]) {
    const { pid } = await this.pve.post(this.vm(vmid, '/agent/exec'), z.object({ pid: num }), {
      command,
      ...(inputData === undefined ? {} : { 'input-data': inputData }),
    });
    const started = Date.now();
    for (;;) {
      const s = await this.pve.get(this.vm(vmid, '/agent/exec-status'), execStatusSchema, { pid });
      if (s.exited) {
        if (!okCodes.includes(s.exitcode ?? -1))
          throw new Error(`comando no convidado falhou (código ${s.exitcode}): ${(s['err-data'] ?? '').trim().slice(0, 300)}`);
        return s['out-data'] ?? '';
      }
      if (Date.now() - started > timeoutMs) throw new Error('comando no convidado não terminou a tempo');
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  /**
   * O guest agent sobe ANTES de o cloud-init terminar de criar o usuário e gravar as chaves (medido no lab: a VPS chegou
   * a RUNNING com o authorized_keys ainda sendo escrito). `cloud-init status --wait` sai com 0 (ok), 2 (concluído com
   * avisos, como o `user:` deprecated, CLAUDE.md C8) ou 1 (erro).
   */
  async waitForCloudInit(vmid: number, timeoutMs = 180_000) {
    await this.exec(vmid, ['cloud-init', 'status', '--wait'], undefined, timeoutMs, [0, 2]);
  }

  async allowKeyLogin(vmid: number, family: string, username: string) {
    const command = imageProfile(family).unlockForKeyLogin;
    if (command) await this.exec(vmid, [...command, username]);
  }

  async setSshPasswordAuth(vmid: number, family: string, enabled: boolean) {
    const profile = imageProfile(family);
    await this.pve.post(this.vm(vmid, '/agent/file-write'), nothing, { file: profile.sshdDropIn, content: sshdPolicy(enabled) });
    await this.exec(vmid, profile.reloadSshd);
  }

  async addAuthorizedKey(vmid: number, username: string, publicKey: string) {
    // O usuário e a chave vão como argumento posicional ($1) e pela entrada padrão: nunca interpolados no script.
    const script =
      'set -e; h=$(getent passwd "$1" | cut -d: -f6); [ -n "$h" ]; g=$(id -gn "$1"); ' +
      'mkdir -p "$h/.ssh"; cat >> "$h/.ssh/authorized_keys"; ' +
      'chown "$1:$g" "$h/.ssh" "$h/.ssh/authorized_keys"; chmod 700 "$h/.ssh"; chmod 600 "$h/.ssh/authorized_keys"';
    await this.exec(vmid, ['sh', '-c', script, 'favo-add-key', username], `${publicKey.replace(/\r/g, '').trim()}\n`);
  }

  async openConsole(vmid: number): Promise<ConsoleTicket> {
    const r = await this.pve.post(this.vm(vmid, '/vncproxy'), z.object({ port: num, ticket: z.string(), password: z.string() }), {
      websocket: true,
    });
    return { port: r.port, ticket: r.ticket, password: r.password };
  }
}
