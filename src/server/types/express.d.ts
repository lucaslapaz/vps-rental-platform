import type { AuthenticatedUser } from '../models/AuthenticatedUser.ts';

declare global {
  namespace Express {
    interface Request {
      /** Preenchido pelo middleware `authenticate` (plano §9.5). */
      user?: AuthenticatedUser;
    }
  }
}
