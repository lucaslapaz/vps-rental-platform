import { afterAll, describe, expect, it } from 'vitest';
import { loadSeedEnv } from '../../prisma/seed/env.ts';
import { runSeed } from '../../prisma/seed/run.ts';
import { UserRepository } from '../../src/server/repositories/UserRepository.ts';
import { SYSTEM_ROLES } from '../../src/shared/constants/permissions.ts';
import { closeTestPrisma, testPrisma } from '../helpers/app.ts';

describe('seed (banco de teste)', () => {
  const db = testPrisma();
  afterAll(closeTestPrisma);

  const counts = async () => ({
    permissions: await db.permission.count(),
    roles: await db.role.count(),
    rolePermissions: await db.rolePermission.count(),
    users: await db.user.count(),
    plans: await db.plan.count(),
    osTemplates: await db.osTemplate.count(),
    ips: await db.ipAddress.count(),
  });

  it('é idempotente: rodar duas vezes não duplica nada', async () => {
    const env = loadSeedEnv();
    await runSeed(db, env);
    const first = await counts();
    const second = await runSeed(db, env);
    expect(await counts()).toEqual(first);
    expect(second.users.created).toBe(0);
    expect(second.ips.created).toBe(0);
    const expectedLinks = Object.values(SYSTEM_ROLES).reduce((n, r) => n + r.permissions.length, 0);
    expect(first.rolePermissions).toBe(expectedLinks);
  }, 30_000);

  it('o técnico de suporte não tem nenhuma permissão de VPS, faturas ou chaves SSH', async () => {
    const agent = await new UserRepository(db).findByEmail('CARLA@favo.local');
    const keys = agent?.role.permissions.map((rp) => rp.permission.key) ?? [];
    expect(agent?.role.key).toBe('support_agent');
    expect(keys).toContain('support:conversation:claim');
    expect(keys.filter((k) => /^(vps|billing|sshkey):/.test(k))).toEqual([]);
  });

  it('o seed de produção falha com mensagem clara sem o admin inicial', () => {
    expect(() => loadSeedEnv({ NODE_ENV: 'production' })).toThrow(/SEED_ADMIN_EMAIL: obrigatório em produção/);
  });
});
