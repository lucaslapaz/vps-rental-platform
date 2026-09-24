import { z } from 'zod';
import { PERMISSION_KEYS, type Permission } from '../constants/permissions.ts';

/** Chave de role criada pelo admin: minúsculas, dígitos e "_" (ex.: financeiro, suporte_n2). */
export const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{2,49}$/;

export const roleKeyParamSchema = z.object({ key: z.string().regex(ROLE_KEY_PATTERN, { error: 'roleKey' }) });

const permissionList = z
  .array(z.enum(PERMISSION_KEYS as [Permission, ...Permission[]], { error: 'permission' }))
  .max(PERMISSION_KEYS.length)
  .transform((list) => [...new Set(list)].sort());

const roleFields = {
  name: z.string().trim().min(2, { error: 'nameTooShort' }).max(100, { error: 'tooLong' }),
  description: z.string().trim().max(255, { error: 'tooLong' }).optional(),
  permissions: permissionList,
};

/** POST /api/admin/roles */
export const createRoleSchema = z.object({
  key: z.string().trim().regex(ROLE_KEY_PATTERN, { error: 'roleKey' }),
  ...roleFields,
});
export type CreateRoleInput = z.input<typeof createRoleSchema>;

/** PUT /api/admin/roles/:key (só roles criadas pelo admin; as do sistema vêm do código) */
export const updateRoleSchema = z.object(roleFields);
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

export const ADMIN_JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
/** periodic=true inclui reconcile, billing_cycle etc. (rodam a cada minuto e encheriam a lista). */
export const adminJobsQuerySchema = z.object({ status: z.enum(ADMIN_JOB_STATUSES).optional(), periodic: z.stringbool().optional() });
export const adminVpsQuerySchema = z.object({
  query: z.string().trim().max(120).optional(),
  includeDeleted: z.stringbool().optional(),
});
