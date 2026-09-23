import type { WebSocket } from 'ws';

/**
 * Contrato entre o domínio (services, jobs) e a infraestrutura de virtualização (plano §3.1). A implementação real é o
 * QemuCloudInitProvider (Proxmox); os testes usam um fake. Nada aqui menciona detalhes do Proxmox.
 */
export type PowerAction = 'start' | 'shutdown' | 'stop' | 'reboot' | 'reset';
export type MetricsTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface VmSpec {
  cores: number;
  memoryMb: number;
  bandwidthMbps: number;
}

export interface CloudInitSpec {
  user: string;
  /** Senha do usuário (texto puro só em memória; o Proxmox guarda o hash). */
  password?: string;
  sshKeys: string[];
  ip: string;
  prefix: number;
  gateway: string;
  macAddress: string;
  nameservers: string[];
}

export interface VmStatus {
  vmid: number;
  name: string;
  status: 'running' | 'stopped' | 'paused' | 'unknown';
  uptimeSeconds: number;
  cpu: number; // fração 0..1 do total de vCPUs
  cpus: number;
  memUsedBytes: number;
  memMaxBytes: number;
  diskMaxBytes: number;
  netInBytes: number;
  netOutBytes: number;
  agentEnabled: boolean;
  lock?: string;
}

export interface MetricPoint {
  time: number; // epoch em segundos
  cpu?: number;
  memUsed?: number;
  memMax?: number;
  netIn?: number;
  netOut?: number;
  diskRead?: number;
  diskWrite?: number;
}

export interface PendingChange {
  key: string;
  value?: string | number;
  pending?: string | number;
  delete?: number;
}

export interface NodeCapacity {
  memTotalBytes: number;
  memUsedBytes: number;
  memFreeBytes: number;
  /** Memória que pode ser usada sem tirar de ninguém (inclui o cache reaproveitável). É a que decide a capacidade. */
  memAvailableBytes: number;
  storageTotalBytes: number;
  storageUsedBytes: number;
  storageAvailBytes: number;
  cpuCount: number;
  pveVersion: string;
}

export interface ConsoleTicket {
  port: number;
  ticket: string;
  /** Senha do protocolo VNC (plano §10.5). */
  password: string;
}

export interface VirtualizationProvider {
  /** true se a API responde (usado no /api/health). */
  ping(): Promise<boolean>;
  /** Próximo VMID livre a partir de `start` (e que o Proxmox confirme como livre). */
  nextFreeVmid(start: number): Promise<number>;
  exists(vmid: number): Promise<boolean>;
  cloneFromTemplate(input: { templateVmid: number; vmid: number; name: string; description: string }): Promise<void>;
  configure(vmid: number, spec: VmSpec, cloudInit: CloudInitSpec, extra?: { tags?: string[] }): Promise<void>;
  /** Aplica CPU/RAM/banda (troca de plano); com a VM ligada, fica pendente até reiniciar. */
  updateResources(vmid: number, spec: VmSpec, macAddress: string): Promise<void>;
  rename(vmid: number, name: string): Promise<void>;
  resizeDisk(vmid: number, sizeGb: number): Promise<void>;
  power(vmid: number, action: PowerAction): Promise<void>;
  status(vmid: number): Promise<VmStatus | null>;
  pendingChanges(vmid: number): Promise<PendingChange[]>;
  destroy(vmid: number): Promise<void>;
  metrics(vmid: number, timeframe: MetricsTimeframe): Promise<MetricPoint[]>;
  listManagedVmids(): Promise<number[]>;
  capacity(): Promise<NodeCapacity>;

  // Guest agent (plano §10.6)
  agentPing(vmid: number): Promise<boolean>;
  waitForAgent(vmid: number, timeoutMs?: number): Promise<void>;
  /** Espera o cloud-init do primeiro boot terminar (usuário, chaves e rede aplicados). */
  waitForCloudInit(vmid: number, timeoutMs?: number): Promise<void>;
  /** Conta criada só com chave SSH: garante que o sshd aceite a chave (no Alpine, a conta nasce bloqueada). */
  allowKeyLogin(vmid: number, family: string, username: string): Promise<void>;
  setUserPassword(vmid: number, username: string, password: string): Promise<void>;
  setSshPasswordAuth(vmid: number, family: string, enabled: boolean): Promise<void>;
  addAuthorizedKey(vmid: number, username: string, publicKey: string): Promise<void>;
  /** Fim do 1º boot: desliga o cloud-init para que mudanças futuras na config não o façam rodar de novo (C23). */
  finalizeFirstBoot(vmid: number): Promise<void>;
  /** Hostname dentro da VM (renomear), sem depender do cloud-init. */
  setGuestHostname(vmid: number, hostname: string): Promise<void>;
  /** Expande a raiz até o fim do disco, com a VM ligada (depois de resizeDisk). */
  growRootFs(vmid: number): Promise<void>;
  /** Uso da raiz visto de dentro da VM (null se o agente não responder). */
  guestDiskUsage(vmid: number): Promise<{ usedBytes: number; totalBytes: number } | null>;

  openConsole(vmid: number): Promise<ConsoleTicket>;
  /** Abre o WebSocket VNC da VM com o ticket do openConsole (o backend faz a ponte com o navegador). */
  connectConsole(vmid: number, ticket: ConsoleTicket): WebSocket;
}
