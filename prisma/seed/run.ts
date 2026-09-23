import type { Database } from '../../src/server/db/prisma.ts';
import { seedCatalog, seedIpPool } from './catalog-seed.ts';
import { ipPoolFor, type SeedEnv } from './env.ts';
import { seedPermissions, seedRoles } from './rbac.ts';
import { seedUsers, usersFor } from './users.ts';

/** Executa o seed completo. Idempotente: rodar duas vezes não duplica nada (plano §8.4). Nunca cria VMs. */
export async function runSeed(db: Database, env: SeedEnv, log: (msg: string) => void = () => {}) {
  const permissions = await seedPermissions(db);
  log(`permissões: ${permissions.total} (removidas: ${permissions.removed})`);
  const roles = await seedRoles(db);
  log(`roles: ${roles.total}`);
  const catalog = await seedCatalog(db);
  log(`planos: ${catalog.plans} · imagens: ${catalog.osTemplates}`);
  const pool = ipPoolFor(env);
  const ips = await seedIpPool(db, pool);
  log(`IPs ${pool.start}–${pool.end}: ${ips.total} (novos: ${ips.created})`);
  const users = await seedUsers(db, usersFor(env));
  log(`usuários: ${users.total} (novos: ${users.created})`);
  return { permissions, roles, catalog, ips, users };
}
