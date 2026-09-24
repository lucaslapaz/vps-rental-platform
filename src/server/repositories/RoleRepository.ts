import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

@injectable()
export class RoleRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  findByKey(key: string) {
    return this.db.role.findUnique({ where: { key } });
  }

  /** Cria a role com as permissões (por chave) numa transação. */
  create(data: { key: string; name: string; description: string | null; permissions: string[] }) {
    return this.db.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { key: data.key, name: data.name, description: data.description, isSystem: false } });
      await this.setPermissions(tx, role.id, data.permissions);
      return role;
    });
  }

  /** Troca nome, descrição e o conjunto de permissões de uma role. */
  update(roleId: number, data: { name: string; description: string | null; permissions: string[] }) {
    return this.db.$transaction(async (tx) => {
      await tx.role.update({ where: { id: roleId }, data: { name: data.name, description: data.description } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await this.setPermissions(tx, roleId, data.permissions);
    });
  }

  countUsers(roleId: number) {
    return this.db.user.count({ where: { roleId } });
  }

  delete(roleId: number) {
    return this.db.$transaction([this.db.rolePermission.deleteMany({ where: { roleId } }), this.db.role.delete({ where: { id: roleId } })]);
  }

  private async setPermissions(tx: Parameters<Parameters<Database['$transaction']>[0]>[0], roleId: number, keys: string[]) {
    if (!keys.length) return;
    const perms = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
  }

  listWithPermissions() {
    return this.db.role.findMany({
      include: { permissions: { include: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
      orderBy: { id: 'asc' },
    });
  }
}
