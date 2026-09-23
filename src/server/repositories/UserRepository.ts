import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

/** Usuário com a role e a lista de permissões, na forma que a autenticação precisa (plano §9.5). */
const withRolePermissions = {
  role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
} as const;

@injectable()
export class UserRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email: email.toLowerCase() }, include: withRolePermissions });
  }

  findById(id: string) {
    return this.db.user.findUnique({ where: { id }, include: withRolePermissions });
  }
}
