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
      userCount: r._count.users,
    }));
  }

  /**
   * Editor de roles (plano §9.7, Fase 10). As roles do SISTEMA ficam de fora: a fonte da verdade delas é o código
   * (`SYSTEM_ROLES`, reaplicado pelo seed), e travá-las também impede um admin de tirar de si mesmo o acesso à
   * administração. As permissões são lidas do banco a cada requisição, então a mudança vale na hora para quem tem a role.
   */
  async createRole(actorId: string, input: { key: string; name: string; description?: string; permissions: string[] }, ip: string | null) {
    if (await this.roles.findByKey(input.key)) throw new AppError(409, 'ROLE_EXISTS', 'Já existe uma role com essa chave');
    const role = await this.roles.create({ ...input, description: input.description || null });
    await this.audit.record({
      action: 'admin.role_created',
      actorId,
      targetType: 'role',
      targetId: role.key,
      metadata: { permissions: input.permissions },
      ip,
    });
    return (await this.listRoles()).find((r) => r.key === role.key);
  }

  async updateRole(actorId: string, key: string, input: { name: string; description?: string; permissions: string[] }, ip: string | null) {
    const role = await this.editableRole(key);
    await this.roles.update(role.id, { ...input, description: input.description || null });
    await this.audit.record({
      action: 'admin.role_updated',
      actorId,
      targetType: 'role',
      targetId: key,
      metadata: { permissions: input.permissions },
      ip,
    });
    return (await this.listRoles()).find((r) => r.key === key);
  }

  async deleteRole(actorId: string, key: string, ip: string | null) {
    const role = await this.editableRole(key);
    const users = await this.roles.countUsers(role.id);
    if (users > 0) throw new AppError(409, 'ROLE_IN_USE', 'Há usuários com esta role', { users });
    await this.roles.delete(role.id);
    await this.audit.record({ action: 'admin.role_deleted', actorId, targetType: 'role', targetId: key, ip });
  }

  private async editableRole(key: string) {
    const role = await this.roles.findByKey(key);
    if (!role) throw AppError.notFound('Role não encontrada');
    if (role.isSystem) throw new AppError(409, 'SYSTEM_ROLE_READONLY', 'As roles do sistema são definidas no código');
    return role;
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
