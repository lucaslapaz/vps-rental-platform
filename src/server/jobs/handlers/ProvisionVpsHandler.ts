import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import type { Database } from '../../db/prisma.ts';
import type { VirtualizationProvider } from '../../integrations/virtualization/VirtualizationProvider.ts';
import { IpamService } from '../../services/IpamService.ts';
import type { ProvisionSecrets } from '../../services/OrderService.ts';
import { VpsNotifier } from '../../services/VpsNotifier.ts';
import type { SecretBox } from '../../utils/secretBox.ts';
import { waitForTcp } from '../../utils/tcp.ts';
import { errorMessage, type JobContext, type JobHandler, PermanentJobError } from './types.ts';

const GB = 1024 ** 3;

const payloadSchema = z.object({
  vpsId: z.string(),
  /** ProvisionSecrets cifrado (SecretBox). Vira null assim que o pós-boot termina (plano §10.6). */
  secrets: z.string().nullable().optional(),
  vmid: z.number().int().optional(),
  /** Gravado ANTES do clone: só destruímos numa falha uma VM que nós mesmos criamos. */
  cloneStarted: z.boolean().optional(),
  configured: z.boolean().optional(),
  accessApplied: z.boolean().optional(),
});

/**
 * Cria a VPS no Proxmox (plano §11.3). Cada passo confere o estado REAL antes de agir e grava o progresso no payload,
 * então o job pode ser interrompido em qualquer ponto (queda do servidor, erro de rede) e retomado sem duplicar a VM.
 */
@injectable()
export class ProvisionVpsHandler implements JobHandler {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(TOKENS.SecretBox) private readonly secretBox: SecretBox,
    @inject(IpamService) private readonly ipam: IpamService,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
  ) {}

  private load(vpsId: string) {
    return this.db.vps.findUnique({ where: { id: vpsId }, include: { osTemplate: true } });
  }

  private openSecrets(sealed: string | null | undefined): ProvisionSecrets {
    if (!sealed) throw new PermanentJobError('os segredos do provisionamento não estão mais no payload');
    return JSON.parse(this.secretBox.open(sealed)) as ProvisionSecrets;
  }

  /** VMID livre no Proxmox E no banco (índice único em pveVmid): dois jobs simultâneos nunca ficam com o mesmo. */
  private async allocateVmid(vpsId: string) {
    let start = this.env.PVE_VMID_START;
    for (let i = 0; i < 50; i++) {
      const vmid = await this.vms.nextFreeVmid(start);
      try {
        await this.db.vps.update({ where: { id: vpsId }, data: { pveVmid: vmid, pveNode: this.env.PVE_NODE } });
        return vmid;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        start = vmid + 1;
      }
    }
    throw new Error('não foi possível reservar um VMID');
  }

  async run(ctx: JobContext) {
    const p = payloadSchema.parse(ctx.job.payload);
    let vps = await this.load(p.vpsId);
    if (vps?.status !== 'PROVISIONING') {
      ctx.logger.warn({ vpsId: p.vpsId, status: vps?.status }, 'provision_vps: a VPS não está mais em PROVISIONING');
      await ctx.save({ secrets: null });
      return;
    }
    const owner = { id: vps.id, userId: vps.userId };

    // 1. IP (FREE → RESERVED, atômico; numa nova tentativa devolve o mesmo)
    if (!vps.ipAddressId) await this.notify.progress(owner, 'ip');
    const ip = await this.ipam.reserveFor(vps.id);

    // 2. VMID
    const vmid = vps.pveVmid ?? (await this.allocateVmid(vps.id));
    if (p.vmid !== vmid) await ctx.save({ vmid });

    // 3. Clone (linked clone do template da imagem)
    let current = await this.vms.status(vmid);
    if (current && !(p.cloneStarted && current.name === vps.hostname)) {
      // O VMID foi ocupado por outra VM entre a checagem e o clone: solta o VMID e tenta de novo com outro.
      await this.db.vps.update({ where: { id: vps.id }, data: { pveVmid: null } });
      await ctx.save({ vmid: undefined, cloneStarted: false });
      throw new Error(`VMID ${vmid} já está em uso por outra VM`);
    }
    if (!current) {
      await this.notify.progress(owner, 'cloning');
      await ctx.save({ cloneStarted: true });
      await this.vms.cloneFromTemplate({
        templateVmid: vps.osTemplate.pveTemplateVmid,
        vmid,
        name: vps.hostname,
        description: `Favo VPS ${vps.id}`,
      });
      current = await this.vms.status(vmid);
    }
    if (!current) throw new Error(`a VM ${vmid} não apareceu depois do clone`);
    if (current.lock) throw new Error(`a VM ${vmid} ainda está bloqueada (${current.lock})`);

    // 4. Configuração (CPU, RAM, banda, cloud-init) e disco. Só antes do primeiro boot.
    if (!p.configured) {
      await this.notify.progress(owner, 'configuring');
      const secrets = this.openSecrets(p.secrets);
      await this.vms.configure(
        vmid,
        { cores: vps.cores, memoryMb: vps.memoryMb, bandwidthMbps: vps.bandwidthMbps },
        {
          user: vps.username,
          ...(secrets.password ? { password: secrets.password } : {}),
          sshKeys: secrets.sshKeys,
          ip: ip.address,
          prefix: ip.prefix,
          gateway: ip.gateway,
          macAddress: ip.macAddress,
          nameservers: this.env.VPS_NAMESERVERS.split(/\s+/).filter(Boolean),
        },
        { tags: ['vpsplatform'] },
      );
      // Anti-spoofing: a VPS só sai com o próprio IP e MAC (Fase 10).
      await this.vms.applyNetworkFirewall(vmid, ip.address);
      // O clone herda o disco do template; só aumenta (diminuir não é suportado, CLAUDE.md A8).
      if (current.diskMaxBytes < vps.diskGb * GB) await this.vms.resizeDisk(vmid, vps.diskGb);
      await ctx.save({ configured: true });
    }

    // 5. Ligar e esperar o guest agent (a VM bootou e o cloud-init começou)
    if ((await this.vms.status(vmid))?.status !== 'running') {
      await this.notify.progress(owner, 'starting');
      await this.vms.power(vmid, 'start');
    }
    await this.notify.progress(owner, 'booting');
    await this.vms.waitForAgent(vmid, 300_000);
    // O agente sobe antes de o cloud-init criar o usuário e gravar as chaves: sem esperar, a VPS ficava RUNNING com
    // o SSH ainda recusando a chave.
    await this.vms.waitForCloudInit(vmid, 240_000);

    // 6. Pós-boot pelo guest agent: senha root e política de SSH. Depois, a senha cifrada sai do payload.
    if (!p.accessApplied) {
      await this.notify.progress(owner, 'access');
      const secrets = this.openSecrets(p.secrets);
      if (secrets.rootPassword) await this.vms.setUserPassword(vmid, 'root', secrets.rootPassword);
      if (!secrets.password) await this.vms.allowKeyLogin(vmid, vps.osTemplate.family, vps.username);
      await this.vms.setSshPasswordAuth(vmid, vps.osTemplate.family, vps.sshPasswordAuth);
      // Daqui em diante o cloud-init não roda mais: renomear ou mudar a config não regenera as chaves de host (C23).
      await this.vms.finalizeFirstBoot(vmid);
      await ctx.save({ accessApplied: true, secrets: null });
    }
    if (this.env.VPS_WAIT_SSH && !(await waitForTcp(ip.address, 22, 120_000))) {
      ctx.logger.warn({ vpsId: vps.id, ip: ip.address }, 'a porta 22 não abriu em 120 s; marcando RUNNING mesmo assim');
    }

    // 7. Pronto: IP ASSIGNED, VPS RUNNING
    vps = await this.load(vps.id);
    if (vps?.status !== 'PROVISIONING') return;
    await this.db.$transaction([
      this.db.ipAddress.update({ where: { id: ip.id }, data: { status: 'ASSIGNED' } }),
      this.db.vps.updateMany({ where: { id: vps.id, status: 'PROVISIONING' }, data: { status: 'RUNNING', lastError: null } }),
    ]);
    await this.notify.event(vps.id, 'create', 'succeeded', { message: ip.address });
    await this.notify.progress(owner, 'ready');
    this.notify.status(owner, 'RUNNING', null);
  }

  /** Falha definitiva (§11.3, passo 8): apaga a VM parcial (se foi nós que clonamos), devolve o IP e marca ERROR. */
  async onFinalFailure(ctx: JobContext, error: unknown) {
    await ctx.save({ secrets: null });
    const p = payloadSchema.parse(ctx.job.payload);
    const vps = await this.load(p.vpsId);
    if (vps?.status !== 'PROVISIONING') return;

    let vmGone = !vps.pveVmid;
    if (vps.pveVmid && p.cloneStarted) {
      try {
        const current = await this.vms.status(vps.pveVmid);
        if (current && current.name === vps.hostname) await this.vms.destroy(vps.pveVmid);
        vmGone = true;
      } catch (err) {
        ctx.logger.error({ err, vmid: vps.pveVmid }, 'não foi possível apagar a VM parcial; o reconcile vai registrá-la');
      }
    } else if (vps.pveVmid) {
      vmGone = true; // o VMID foi reservado, mas o clone nem começou
    }
    await this.ipam.release(vps.id);
    await this.db.vps.updateMany({
      where: { id: vps.id, status: 'PROVISIONING' },
      data: { status: 'ERROR', lastError: 'PROVISION_FAILED', ...(vmGone ? { pveVmid: null } : {}) },
    });
    // O detalhe técnico fica no Job.lastError e no log; o histórico que o cliente vê leva só o código.
    ctx.logger.error({ vpsId: vps.id, err: errorMessage(error) }, 'provisionamento falhou de vez');
    await this.notify.event(vps.id, 'create', 'failed', { message: 'PROVISION_FAILED' });
    this.notify.status({ id: vps.id, userId: vps.userId }, 'ERROR', 'PROVISION_FAILED');
  }
}
