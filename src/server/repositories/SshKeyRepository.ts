import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

@injectable()
export class SshKeyRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  listByUser(userId: string) {
    return this.db.sshKey.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }

  countByUser(userId: string) {
    return this.db.sshKey.count({ where: { userId } });
  }

  findByFingerprint(userId: string, fingerprint: string) {
    return this.db.sshKey.findUnique({ where: { userId_fingerprint: { userId, fingerprint } } });
  }

  create(data: { userId: string; name: string; publicKey: string; fingerprint: string }) {
    return this.db.sshKey.create({ data });
  }

  /** Apaga só se a chave for do usuário (a checagem de propriedade fica no WHERE). */
  async deleteOwned(id: number, userId: string) {
    const r = await this.db.sshKey.deleteMany({ where: { id, userId } });
    return r.count > 0;
  }
}
