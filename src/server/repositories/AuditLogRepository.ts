import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';
import type { InputJsonValue } from '../generated/prisma/internal/prismaNamespace.ts';

export interface AuditEntry {
  action: string; // auth.login_failed, admin.user_role_changed…
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: InputJsonValue;
  ip?: string | null;
}

@injectable()
export class AuditLogRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  record(entry: AuditEntry) {
    return this.db.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.ip ?? null,
        ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
      },
    });
  }
}
