import { inject, injectable } from 'tsyringe';
import type { vpsAddSshKeySchema, vpsPasswordSchema } from '../../shared/schemas/vps.ts';
import type { VpsDTO } from '../../shared/types/catalog.ts';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { VirtualizationProvider } from '../integrations/virtualization/VirtualizationProvider.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { SshKeyRepository } from '../repositories/SshKeyRepository.ts';
import { toVpsDTO, VpsRepository } from '../repositories/VpsRepository.ts';
import { AppError } from '../utils/errors.ts';
import { parseSshPublicKey } from '../utils/sshKey.ts';
import { VpsNotifier } from './VpsNotifier.ts';

type PasswordInput = import('zod').output<typeof vpsPasswordSchema>;
type AddKeyInput = import('zod').output<typeof vpsAddSshKeySchema>;

const invalid = (code: string, message: string, path: string) => new AppError(422, code, message, [{ path, message: code }]);

/**
 * Ações dentro da VM pelo guest agent (plano §10.6), SEM reiniciar: redefinir senhas, SSH por senha, adicionar chave e
 * renomear. São síncronas (1–3 s) e exigem a VPS ligada. As senhas vão direto ao Proxmox por TLS e não passam pelo
 * banco nem pela fila; os comandos executados são fixos (ImageProfile), com o texto do usuário só como argumento.
 */
@injectable()
export class VpsAccessService {
  constructor(
    @inject(TOKENS.Prisma) private readonly db: Database,
    @inject(TOKENS.VirtualizationProvider) private readonly vms: VirtualizationProvider,
    @inject(VpsRepository) private readonly vps: VpsRepository,
    @inject(SshKeyRepository) private readonly sshKeys: SshKeyRepository,
    @inject(VpsNotifier) private readonly notify: VpsNotifier,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  private async running(userId: string, vpsId: string) {
    const vps = await this.vps.findOwned(vpsId, userId);
    if (!vps || vps.status === 'DELETED') throw AppError.notFound('VPS não encontrada');
    if (vps.status !== 'RUNNING' || !vps.pveVmid) throw new AppError(409, 'VPS_NOT_RUNNING', 'Ligue a VPS para fazer esta alteração');
    return { ...vps, pveVmid: vps.pveVmid };
  }

  private async dto(userId: string, vpsId: string): Promise<VpsDTO> {
    const found = await this.vps.findOwned(vpsId, userId);
    if (!found) throw AppError.notFound('VPS não encontrada');
    return toVpsDTO(found);
  }

  async setPassword(userId: string, vpsId: string, input: PasswordInput, ip: string | null) {
    const vps = await this.running(userId, vpsId);
    if (input.target === 'root') {
      const template = await this.db.osTemplate.findUniqueOrThrow({ where: { id: vps.osTemplateId } });
      if (!template.supportsRootPassword) throw invalid('ROOT_PASSWORD_NOT_SUPPORTED', 'Imagem sem senha root', 'target');
    }
    await this.vms.setUserPassword(vps.pveVmid, input.target === 'root' ? 'root' : vps.username, input.password);
    if (input.target === 'root' && !vps.rootPasswordSet)
      await this.db.vps.update({ where: { id: vps.id }, data: { rootPasswordSet: true } });
    await this.notify.event(vps.id, 'password', 'succeeded', { actorId: userId, message: input.target });
    await this.audit.record({
      action: 'vps.password_reset',
      actorId: userId,
      targetType: 'vps',
      targetId: vps.id,
      metadata: { target: input.target },
      ip,
    });
    return this.dto(userId, vpsId);
  }

  async setSshPasswordAuth(userId: string, vpsId: string, enabled: boolean, ip: string | null) {
    const vps = await this.running(userId, vpsId);
    await this.vms.setSshPasswordAuth(vps.pveVmid, vps.osTemplate.family, enabled);
    await this.db.vps.update({ where: { id: vps.id }, data: { sshPasswordAuth: enabled } });
    await this.notify.event(vps.id, 'ssh_password_auth', 'succeeded', { actorId: userId, message: enabled ? 'on' : 'off' });
    await this.audit.record({
      action: 'vps.ssh_password_auth',
      actorId: userId,
      targetType: 'vps',
      targetId: vps.id,
      metadata: { enabled },
      ip,
    });
    return this.dto(userId, vpsId);
  }

  /**
   * Acrescenta a chave no authorized_keys do usuário (agent/exec com a chave pela entrada padrão). A config `sshkeys` do
   * Proxmox NÃO é alterada: com o cloud-init congelado ela não teria efeito, e mudá-la só trocaria o instance-id (C23).
   */
  async addSshKey(userId: string, vpsId: string, input: AddKeyInput, ip: string | null) {
    const vps = await this.running(userId, vpsId);
    let line: string;
    let fingerprint: string;
    if (input.sshKeyId) {
      const key = (await this.sshKeys.listByUser(userId)).find((k) => k.id === input.sshKeyId);
      if (!key) throw invalid('SSH_KEY_NOT_FOUND', 'Chave SSH não encontrada', 'sshKeyId');
      line = key.publicKey;
      fingerprint = key.fingerprint;
    } else {
      const parsed = parseSshPublicKey(input.publicKey ?? '');
      if (!parsed) throw invalid('SSH_KEY_INVALID', 'Chave SSH inválida', 'publicKey');
      line = parsed.line;
      fingerprint = parsed.fingerprint;
      const saved = await this.sshKeys.listByUser(userId);
      if (input.save && !saved.some((k) => k.fingerprint === parsed.fingerprint)) {
        await this.sshKeys.create({
          userId,
          name: input.name || `chave-${vps.hostname}`,
          publicKey: parsed.line,
          fingerprint: parsed.fingerprint,
        });
      }
    }
    await this.vms.addAuthorizedKey(vps.pveVmid, vps.username, line);
    await this.notify.event(vps.id, 'ssh_key', 'succeeded', { actorId: userId, message: fingerprint });
    await this.audit.record({
      action: 'vps.ssh_key_added',
      actorId: userId,
      targetType: 'vps',
      targetId: vps.id,
      metadata: { fingerprint },
      ip,
    });
    return this.dto(userId, vpsId);
  }

  /** Renomear: nome da VM no Proxmox + hostname dentro da VM, na hora (o cloud-init está congelado, C23). */
  async rename(userId: string, vpsId: string, hostname: string, ip: string | null) {
    const vps = await this.running(userId, vpsId);
    if (hostname === vps.hostname) return this.dto(userId, vpsId);
    await this.vms.setGuestHostname(vps.pveVmid, hostname);
    await this.vms.rename(vps.pveVmid, hostname);
    await this.db.vps.update({ where: { id: vps.id }, data: { hostname } });
    await this.notify.event(vps.id, 'rename', 'succeeded', { actorId: userId, message: `${vps.hostname} → ${hostname}` });
    await this.audit.record({
      action: 'vps.renamed',
      actorId: userId,
      targetType: 'vps',
      targetId: vps.id,
      metadata: { from: vps.hostname, to: hostname },
      ip,
    });
    this.notify.status(vps, vps.status as VpsDTO['status'], null);
    return this.dto(userId, vpsId);
  }
}
