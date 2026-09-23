import type { Database } from '../../src/server/db/prisma.ts';
import { ipRange, macFromIp } from '../../src/server/utils/ipv4.ts';
import { OS_TEMPLATES, PLANS } from './catalog.ts';

/** Planos e imagens: o código é a fonte da verdade, então o seed atualiza os campos a cada execução. */
export async function seedCatalog(db: Database) {
  for (const plan of PLANS) {
    await db.plan.upsert({ where: { slug: plan.slug }, create: plan, update: plan });
  }
  for (const tpl of OS_TEMPLATES) {
    await db.osTemplate.upsert({ where: { slug: tpl.slug }, create: tpl, update: tpl });
  }
  return { plans: PLANS.length, osTemplates: OS_TEMPLATES.length };
}

/**
 * Pool de IPs das VPS. Só cria os que faltam: o `status` dos existentes (RESERVED/ASSIGNED) nunca é tocado.
 * O MAC vem do IP (plano §3.3).
 */
export async function seedIpPool(db: Database, pool: { start: string; end: string; prefix: number; gateway: string }) {
  const addresses = ipRange(pool.start, pool.end);
  const result = await db.ipAddress.createMany({
    data: addresses.map((address) => ({ address, prefix: pool.prefix, gateway: pool.gateway, macAddress: macFromIp(address) })),
    skipDuplicates: true,
  });
  return { total: addresses.length, created: result.count };
}
