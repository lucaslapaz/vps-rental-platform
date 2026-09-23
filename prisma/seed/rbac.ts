import type { Database } from '../../src/server/db/prisma.ts';
import { PERMISSION_KEYS, PERMISSIONS, ROLE_KEYS, SYSTEM_ROLES } from '../../src/shared/constants/permissions.ts';

/** Sincroniza a tabela `permissions` com as constantes do código: cria/atualiza as que existem e apaga as que sumiram. */
export async function seedPermissions(db: Database) {
  for (const key of PERMISSION_KEYS) {
    await db.permission.upsert({
      where: { key },
      create: { key, description: PERMISSIONS[key] },
      update: { description: PERMISSIONS[key] },
    });
  }
  const removed = await db.permission.deleteMany({ where: { key: { notIn: PERMISSION_KEYS } } });
  return { total: PERMISSION_KEYS.length, removed: removed.count };
}

/** Roles do sistema e o vínculo exato role↔permissão definido no código (plano §8.4). */
export async function seedRoles(db: Database) {
  const permissions = await db.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const key of ROLE_KEYS) {
    const def = SYSTEM_ROLES[key];
    const role = await db.role.upsert({
      where: { key },
      create: { key, name: def.name, description: def.description, isSystem: true },
      update: { name: def.name, description: def.description, isSystem: true },
    });
    const wanted = def.permissions.map((p) => {
      const id = idByKey.get(p);
      if (id === undefined) throw new Error(`permissão ${p} não existe na tabela (rode seedPermissions antes)`);
      return id;
    });
    await db.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: { notIn: wanted } } });
    await db.rolePermission.createMany({ data: wanted.map((permissionId) => ({ roleId: role.id, permissionId })), skipDuplicates: true });
  }
  return { total: ROLE_KEYS.length };
}
