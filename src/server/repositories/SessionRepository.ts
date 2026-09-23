import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

const withUser = {
  user: { include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } },
} as const;

@injectable()
export class SessionRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  create(data: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
    absoluteExpiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }) {
    return this.db.session.create({ data });
  }

  /** Sessão + usuário + role + permissões, numa consulta só (plano §9.5). */
  findByTokenHash(tokenHash: string) {
    return this.db.session.findUnique({ where: { tokenHash }, include: withUser });
  }

  touch(id: string, lastSeenAt: Date, expiresAt: Date) {
    return this.db.session.update({ where: { id }, data: { lastSeenAt, expiresAt } });
  }

  /** Revoga uma sessão do usuário (updateMany: não falha nem revela nada se o id for de outro usuário). */
  async revoke(id: string, userId: string, now: Date) {
    const r = await this.db.session.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: now } });
    return r.count > 0;
  }

  async revokeAllForUser(userId: string, now: Date, exceptId?: string) {
    const r = await this.db.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      data: { revokedAt: now },
    });
    return r.count;
  }

  listActive(userId: string, now: Date) {
    return this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
