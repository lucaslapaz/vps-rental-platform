import { inject, injectable } from 'tsyringe';
import { TOKENS } from '../container/tokens.ts';
import type { Database } from '../db/prisma.ts';

@injectable()
export class HealthRepository {
  constructor(@inject(TOKENS.Prisma) private readonly db: Database) {}

  /** true se o banco responde a um SELECT 1 dentro do prazo. */
  async ping(timeoutMs = 2000): Promise<boolean> {
    const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref());
    const query = this.db.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    return Promise.race([query, timeout]);
  }
}
