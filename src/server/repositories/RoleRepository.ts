import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

@injectable()
export class RoleRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  findByKey(key: string) {
    return this.db.role.findUnique({ where: { key } });
  }

  listWithPermissions() {
    return this.db.role.findMany({
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: { id: 'asc' },
    });
  }
}
