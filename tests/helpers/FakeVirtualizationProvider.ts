import { WebSocket } from 'ws';
import type {
  CloudInitSpec,
  ConsoleTicket,
  MetricPoint,
  NodeCapacity,
  PendingChange,
  PowerAction,
  VirtualizationProvider,
  VmSpec,
  VmStatus,
} from '../../src/server/integrations/virtualization/VirtualizationProvider.ts';

interface FakeVm {
  vmid: number;
  name: string;
  status: 'running' | 'stopped';
  spec?: VmSpec;
  cloudInit?: CloudInitSpec;
  diskGb: number;
  sshPasswordAuth?: boolean;
  passwords: Record<string, string>;
  authorizedKeys: string[];
  hostname?: string;
  cloudInitFrozen?: boolean;
  rootFsGb?: number;
}

/**
 * Provider em memória para os testes (plano §18): mesmo contrato do QemuCloudInitProvider, sem Proxmox. Guarda as
 * chamadas em `calls` e permite simular falhas com `failNext`.
 */
export class FakeVirtualizationProvider implements VirtualizationProvider {
  readonly vms = new Map<number, FakeVm>();
  readonly calls: string[] = [];
  online = true;
  /** Memória disponível do nó falso (a capacidade desconta dela as VPS que ainda vão ser criadas). */
  memAvailableMb = 1638;
  /** URL do servidor WebSocket que faz o papel do VNC da VM nos testes do console. */
  consoleUrl = 'ws://127.0.0.1:9';
  private failures = new Map<string, Error>();

  failNext(method: string, error = new Error(`falha simulada em ${method}`)) {
    this.failures.set(method, error);
  }

  private track(method: string, detail = '') {
    this.calls.push(detail ? `${method}:${detail}` : method);
    const failure = this.failures.get(method);
    if (failure) {
      this.failures.delete(method);
      throw failure;
    }
  }

  private get(vmid: number) {
    const vm = this.vms.get(vmid);
    if (!vm) throw new Error(`VM ${vmid} não existe`);
    return vm;
  }

  async ping() {
    return this.online;
  }
  async nextFreeVmid(start: number) {
    this.track('nextFreeVmid');
    let vmid = start;
    while (this.vms.has(vmid)) vmid++;
    return vmid;
  }
  async exists(vmid: number) {
    return this.vms.has(vmid);
  }
  async cloneFromTemplate({ vmid, name }: { templateVmid: number; vmid: number; name: string; description: string }) {
    this.track('clone', String(vmid));
    this.vms.set(vmid, { vmid, name, status: 'stopped', diskGb: 1, passwords: {}, authorizedKeys: [] });
  }
  async configure(vmid: number, spec: VmSpec, cloudInit: CloudInitSpec) {
    this.track('configure', String(vmid));
    Object.assign(this.get(vmid), { spec, cloudInit, authorizedKeys: [...cloudInit.sshKeys] });
  }
  async updateResources(vmid: number, spec: VmSpec) {
    this.track('updateResources', String(vmid));
    this.get(vmid).spec = spec;
  }
  async rename(vmid: number, name: string) {
    this.track('rename', String(vmid));
    this.get(vmid).name = name;
  }
  async resizeDisk(vmid: number, sizeGb: number) {
    this.track('resize', String(vmid));
    const vm = this.get(vmid);
    if (sizeGb < vm.diskGb) throw new Error('Shrinking disk size is not supported');
    vm.diskGb = sizeGb;
  }
  async power(vmid: number, action: PowerAction) {
    this.track('power', `${vmid}:${action}`);
    this.get(vmid).status = action === 'shutdown' || action === 'stop' ? 'stopped' : 'running';
  }
  async status(vmid: number): Promise<VmStatus | null> {
    const vm = this.vms.get(vmid);
    if (!vm) return null;
    return {
      vmid,
      name: vm.name,
      status: vm.status,
      uptimeSeconds: vm.status === 'running' ? 60 : 0,
      cpu: 0.01,
      cpus: vm.spec?.cores ?? 1,
      memUsedBytes: 64 * 1024 * 1024,
      memMaxBytes: (vm.spec?.memoryMb ?? 256) * 1024 * 1024,
      diskMaxBytes: vm.diskGb * 1024 ** 3,
      netInBytes: 0,
      netOutBytes: 0,
      agentEnabled: true,
    };
  }
  async pendingChanges(): Promise<PendingChange[]> {
    return [];
  }
  async destroy(vmid: number) {
    this.track('destroy', String(vmid));
    this.vms.delete(vmid);
  }
  async metrics(): Promise<MetricPoint[]> {
    return [{ time: Math.floor(Date.now() / 1000), cpu: 0.02, memUsed: 64 * 1024 * 1024, memMax: 256 * 1024 * 1024 }];
  }
  async listManagedVmids() {
    return [...this.vms.keys()];
  }
  async capacity(): Promise<NodeCapacity> {
    return {
      memTotalBytes: 3 * 1024 ** 3,
      memUsedBytes: 1.4 * 1024 ** 3,
      memFreeBytes: 1.6 * 1024 ** 3,
      memAvailableBytes: this.memAvailableMb * 1024 * 1024,
      storageTotalBytes: 16 * 1024 ** 3,
      storageUsedBytes: 4 * 1024 ** 3,
      storageAvailBytes: 12 * 1024 ** 3,
      cpuCount: 2,
      pveVersion: 'fake',
    };
  }
  async agentPing(vmid: number) {
    return this.vms.get(vmid)?.status === 'running';
  }
  async waitForAgent(vmid: number) {
    if (!(await this.agentPing(vmid))) throw new Error(`agente da VM ${vmid} não respondeu`);
  }
  async waitForCloudInit(vmid: number) {
    this.track('waitForCloudInit', String(vmid));
  }
  async allowKeyLogin(vmid: number, _family: string, username: string) {
    this.track('allowKeyLogin', `${vmid}:${username}`);
  }
  async setUserPassword(vmid: number, username: string, password: string) {
    this.track('setUserPassword', `${vmid}:${username}`);
    this.get(vmid).passwords[username] = password;
  }
  async setSshPasswordAuth(vmid: number, _family: string, enabled: boolean) {
    this.track('setSshPasswordAuth', `${vmid}:${enabled}`);
    this.get(vmid).sshPasswordAuth = enabled;
  }
  async addAuthorizedKey(vmid: number, _username: string, publicKey: string) {
    this.track('addAuthorizedKey', String(vmid));
    this.get(vmid).authorizedKeys.push(publicKey);
  }
  async finalizeFirstBoot(vmid: number) {
    this.track('finalizeFirstBoot', String(vmid));
    this.get(vmid).cloudInitFrozen = true;
  }
  async setGuestHostname(vmid: number, hostname: string) {
    this.track('setGuestHostname', `${vmid}:${hostname}`);
    this.get(vmid).hostname = hostname;
  }
  async growRootFs(vmid: number) {
    this.track('growRootFs', String(vmid));
    const vm = this.get(vmid);
    if (vm.status !== 'running') throw new Error('agente indisponível: VM desligada');
    vm.rootFsGb = vm.diskGb;
  }
  async guestDiskUsage(vmid: number) {
    const vm = this.vms.get(vmid);
    return vm?.status === 'running' ? { usedBytes: 150 * 1024 ** 2, totalBytes: (vm.rootFsGb ?? vm.diskGb) * 1024 ** 3 } : null;
  }
  connectConsole(vmid: number, ticket: ConsoleTicket) {
    this.track('connectConsole', `${vmid}:${ticket.port}`);
    return new WebSocket(this.consoleUrl, ['binary']);
  }
  async openConsole(vmid: number): Promise<ConsoleTicket> {
    this.track('openConsole', String(vmid));
    return { port: 5900, ticket: 'PVEVNC:fake', password: 'fake-password' };
  }
}
