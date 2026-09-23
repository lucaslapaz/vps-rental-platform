import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

@injectable()
export class CatalogRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  listPlans() {
    return this.db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  listOsTemplates() {
    return this.db.osTemplate.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  findPlan(slug: string) {
    return this.db.plan.findFirst({ where: { slug, isActive: true } });
  }

  findOsTemplate(slug: string) {
    return this.db.osTemplate.findFirst({ where: { slug, isActive: true } });
  }
}
