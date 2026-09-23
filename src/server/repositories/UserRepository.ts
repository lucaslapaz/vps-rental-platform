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

  async create(data: { email: string; name: string; passwordHash: string; roleKey: string }) {
    return this.db.user.create({
      data: { email: data.email.toLowerCase(), name: data.name, passwordHash: data.passwordHash, role: { connect: { key: data.roleKey } } },
      include: withRolePermissions,
    });
  }

  updatePasswordHash(id: string, passwordHash: string) {
    return this.db.user.update({ where: { id }, data: { passwordHash } });
  }

  /** Busca por nome ou e-mail (Administração → Usuários). */
  search(query: string | undefined, take = 50) {
    return this.db.user.findMany({
      where: query ? { OR: [{ name: { contains: query } }, { email: { contains: query } }] } : {},
      include: { role: { select: { key: true } } },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  updateRole(id: string, roleId: number) {
    return this.db.user.update({ where: { id }, data: { roleId }, include: { role: { select: { key: true } } } });
  }
}
