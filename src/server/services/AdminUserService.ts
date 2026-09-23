import { inject, injectable } from 'tsyringe';
import type { AdminUserDTO, RoleDTO } from '../../shared/types/auth.ts';
import { AuditLogRepository } from '../repositories/AuditLogRepository.ts';
import { RoleRepository } from '../repositories/RoleRepository.ts';
import { UserRepository } from '../repositories/UserRepository.ts';
import { AppError } from '../utils/errors.ts';
import { SessionService } from './SessionService.ts';

@injectable()
export class AdminUserService {
  constructor(
    @inject(UserRepository) private readonly users: UserRepository,
    @inject(RoleRepository) private readonly roles: RoleRepository,
    @inject(SessionService) private readonly sessions: SessionService,
    @inject(AuditLogRepository) private readonly audit: AuditLogRepository,
  ) {}

  async search(query: string | undefined): Promise<AdminUserDTO[]> {
    const found = await this.users.search(query || undefined);
    return found.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role.key,
      isActive: u.isActive,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async listRoles(): Promise<RoleDTO[]> {
    const roles = await this.roles.listWithPermissions();
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: r.permissions.map((rp) => rp.permission.key).sort(),
    }));
  }

  /**
   * Troca a role de um usuário (plano §9.7). O admin não pode mudar a própria role, e as sessões do usuário afetado
   * são revogadas para as permissões novas valerem na hora.
   */
  async changeRole(actorId: string, targetId: string, roleKey: string, ip: string | null) {
    if (actorId === targetId) throw new AppError(400, 'CANNOT_CHANGE_OWN_ROLE', 'Você não pode alterar a própria role');
    const target = await this.users.findById(targetId);
    if (!target) throw AppError.notFound('Usuário não encontrado');
    const role = await this.roles.findByKey(roleKey);
    if (!role) throw new AppError(400, 'VALIDATION_ERROR', 'Role inexistente', [{ path: 'role', message: 'role' }]);
    if (target.roleId === role.id) return { changed: false, revokedSessions: 0 };

    await this.users.updateRole(targetId, role.id);
    const revokedSessions = await this.sessions.revokeAllForUser(targetId);
    await this.audit.record({
      action: 'admin.user_role_changed',
      actorId,
      targetType: 'user',
      targetId,
      metadata: { from: target.role.key, to: role.key, revokedSessions },
      ip,
    });
    return { changed: true, revokedSessions };
  }
}
