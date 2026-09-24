import type { Permission, RoleKey } from '../constants/permissions.ts';

/** Dados do usuário autenticado que vão para o frontend (GET /api/auth/me). */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: RoleKey | (string & {});
  permissions: Permission[];
}

export interface SessionDTO {
  id: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
}

export interface SshKeyDTO {
  id: number;
  name: string;
  fingerprint: string;
  type: string;
  createdAt: string;
}

export interface AdminUserDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export interface RoleDTO {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  /** Quantos usuários têm esta role (uma role em uso não pode ser apagada). */
  userCount: number;
}
