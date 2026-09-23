import { z } from 'zod';
import { ROLE_KEYS } from '../constants/permissions.ts';

export const SSH_KEY_TYPES = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa'] as const;

/**
 * Normaliza uma chave pública colada pelo usuário: remove \r (chaves copiadas do Windows vêm com \r\n, CLAUDE.md C4),
 * espaços extras e quebras de linha.
 */
export function normalizePublicKey(raw: string): string {
  return raw.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
}

/** Validação de formato (a checagem completa do blob, com fingerprint, fica no servidor). */
export const sshKeySchema = z.object({
  name: z.string().trim().min(1, { error: 'required' }).max(80, { error: 'tooLong' }),
  publicKey: z
    .string()
    .max(16_384, { error: 'tooLong' })
    .transform(normalizePublicKey)
    .refine((k) => new RegExp(`^(${SSH_KEY_TYPES.join('|')}) [A-Za-z0-9+/]+={0,3}( .*)?$`).test(k), { error: 'sshKeyFormat' }),
});
export type SshKeyInput = z.input<typeof sshKeySchema>;

export const changeRoleSchema = z.object({ role: z.enum(ROLE_KEYS, { error: 'role' }) });
export type ChangeRoleInput = z.input<typeof changeRoleSchema>;

export const uuidParamSchema = z.object({ id: z.uuid({ error: 'id' }) });
export const intIdParamSchema = z.object({ id: z.coerce.number().int().positive({ error: 'id' }) });

export const userSearchSchema = z.object({
  query: z.string().trim().max(120).optional(),
});
