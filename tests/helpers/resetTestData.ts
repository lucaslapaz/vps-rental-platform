import type { Database } from '../../src/server/db/prisma.ts';

/**
 * Apaga os dados TRANSITÓRIOS do banco de teste (VPS, faturas, pagamentos, jobs, conversas de suporte, sessões e os
 * usuários criados pelos testes) e devolve todos os IPs ao pool. O seed (roles, planos, imagens, usuários de
 * demonstração) fica. Roda antes do `npm test` e antes/depois do E2E: uma execução interrompida (ou o E2E, que usa
 * outro provider falso) não deixa IPs presos nem VPS que o reconcile de outra suíte marcaria como ERROR (CLAUDE.md N36).
 */
export async function resetTestData(db: Database, databaseUrl: string) {
  if (!databaseUrl.includes('_test')) throw new Error('resetTestData só roda no banco de teste');
  await db.job.deleteMany({});
  await db.supportMessage.deleteMany({});
  await db.supportConversation.deleteMany({});
  await db.payment.deleteMany({});
  await db.invoice.deleteMany({});
  await db.vpsEvent.deleteMany({});
  await db.vps.deleteMany({});
  await db.ipAddress.updateMany({ data: { status: 'FREE' } });
  // Usuários criados pelos testes (e-mails gerados por uniqueEmail); os de demonstração do seed ficam.
  // uniqueEmail() gera "<prefixo>-<8 hex>@favo.local"; os do seed (ana@, carla@, admin@…) não têm hífen.
  const users = await db.user.findMany({ where: { email: { endsWith: '@favo.local', contains: '-' } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await db.sshKey.deleteMany({ where: { userId: { in: ids } } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
}
