import type { Permission } from '../../shared/constants/permissions.ts';
import type { PublicUser } from '../../shared/types/auth.ts';

/**
 * Usuário autenticado da requisição (`req.user`), criado pelo middleware `authenticate` (plano §9.5).
 * O código verifica PERMISSÕES com `can()`; o nome da role quase nunca importa (§9.7).
 */
export class AuthenticatedUser {
  constructor(
    readonly id: string,
    readonly email: string,
    readonly name: string,
    readonly role: string,
    private readonly permissions: ReadonlySet<Permission>,
    readonly sessionId: string,
  ) {}

  can(permission: Permission): boolean {
    return this.permissions.has(permission);
  }

  toPublic(): PublicUser {
    return { id: this.id, email: this.email, name: this.name, role: this.role, permissions: [...this.permissions].sort() };
  }
}
