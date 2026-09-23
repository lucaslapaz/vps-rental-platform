import { inject, injectable } from 'tsyringe';
import type { SshKeyDTO } from '../../shared/types/auth.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { SshKeyRepository } from '../repositories/SshKeyRepository.ts';
import { AppError } from '../utils/errors.ts';
import { parseSshPublicKey } from '../utils/sshKey.ts';

const MAX_KEYS_PER_USER = 10;

@injectable()
export class SshKeyService {
  constructor(
    @inject(SshKeyRepository) private readonly keys: SshKeyRepository,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  private toDTO(k: { id: number; name: string; fingerprint: string; publicKey: string; createdAt: Date }): SshKeyDTO {
    return {
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
      type: k.publicKey.split(' ')[0] ?? '',
      createdAt: k.createdAt.toISOString(),
    };
  }

  async list(userId: string) {
    return (await this.keys.listByUser(userId)).map((k) => this.toDTO(k));
  }

  async add(userId: string, input: { name: string; publicKey: string }, ip: string | null) {
    const parsed = parseSshPublicKey(input.publicKey);
    if (!parsed) throw new AppError(400, 'SSH_KEY_INVALID', 'Chave SSH inválida');
    if (await this.keys.findByFingerprint(userId, parsed.fingerprint)) throw new AppError(409, 'SSH_KEY_DUPLICATE', 'Chave já cadastrada');
    if ((await this.keys.countByUser(userId)) >= MAX_KEYS_PER_USER) throw new AppError(409, 'SSH_KEY_LIMIT', 'Limite de chaves atingido');
    const key = await this.keys.create({ userId, name: input.name, publicKey: parsed.line, fingerprint: parsed.fingerprint });
    await this.audit.record({ action: 'sshkey.added', actorId: userId, targetType: 'ssh_key', targetId: String(key.id), ip });
    return this.toDTO(key);
  }

  async remove(userId: string, id: number, ip: string | null) {
    // 404 também quando a chave é de outro usuário: não revela que ela existe (plano §9.5).
    if (!(await this.keys.deleteOwned(id, userId))) throw AppError.notFound('Chave não encontrada');
    await this.audit.record({ action: 'sshkey.removed', actorId: userId, targetType: 'ssh_key', targetId: String(id), ip });
  }
}
