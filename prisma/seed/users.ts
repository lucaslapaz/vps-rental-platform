import type { Database } from '../../src/server/db/prisma.ts';
import { hashPassword } from '../../src/server/utils/password.ts';
import type { RoleKey } from '../../src/shared/constants/permissions.ts';
import type { SeedEnv } from './env.ts';

interface SeedUser {
  email: string;
  name: string;
  role: RoleKey;
  password: string;
}

/** Usuários por ambiente (plano §8.4): dev/test têm demonstração; produção só o admin vindo do ambiente. */
export function usersFor(env: SeedEnv): SeedUser[] {
  if (env.NODE_ENV === 'production') {
    // loadSeedEnv já garantiu que as duas variáveis existem em produção.
    return [{ email: env.SEED_ADMIN_EMAIL as string, name: 'Administrador', role: 'admin', password: env.SEED_ADMIN_PASSWORD as string }];
  }
  const password = env.SEED_DEFAULT_PASSWORD as string;
  return [
    {
      email: env.SEED_ADMIN_EMAIL ?? 'admin@favo.local',
      name: 'Administrador',
      role: 'admin',
      password: env.SEED_ADMIN_PASSWORD ?? password,
    },
    { email: 'ana@favo.local', name: 'Ana Souza', role: 'customer', password },
    { email: 'bruno@favo.local', name: 'Bruno Lima', role: 'customer', password },
    { email: 'carla@favo.local', name: 'Carla Mendes', role: 'support_agent', password },
    { email: 'diego@favo.local', name: 'Diego Rocha', role: 'support_agent', password },
  ];
}

/**
 * Cria os usuários que ainda não existem. Os existentes NÃO são alterados (nem senha nem role): o seed nunca desfaz
 * uma troca de role feita pela tela de administração.
 */
export async function seedUsers(db: Database, users: SeedUser[]) {
  const roles = await db.role.findMany({ select: { id: true, key: true } });
  const roleId = new Map(roles.map((r) => [r.key, r.id]));
  let created = 0;
  for (const u of users) {
    const email = u.email.toLowerCase();
    if (await db.user.findUnique({ where: { email }, select: { id: true } })) continue;
    const id = roleId.get(u.role);
    if (id === undefined) throw new Error(`role ${u.role} não existe (rode seedRoles antes)`);
    await db.user.create({ data: { email, name: u.name, passwordHash: await hashPassword(u.password), roleId: id } });
    created++;
  }
  return { total: users.length, created };
}
