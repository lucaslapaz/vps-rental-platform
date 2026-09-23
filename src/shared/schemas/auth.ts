import { z } from 'zod';

/**
 * Schemas compartilhados entre o formulário (react-hook-form) e o servidor (middleware validate).
 * As mensagens são CHAVES de tradução (validation.<chave>): o frontend traduz, o servidor nunca sabe o idioma (§14.4).
 */
export const emailSchema = z
  .email({ error: 'email' })
  .max(254, { error: 'tooLong' })
  .transform((v) => v.trim().toLowerCase());

export const newPasswordSchema = z.string().min(10, { error: 'passwordTooShort' }).max(128, { error: 'tooLong' });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, { error: 'required' }).max(128, { error: 'tooLong' }),
});
export type LoginInput = z.input<typeof loginSchema>;

export const registerSchema = z.object({
  name: z.string().trim().min(2, { error: 'nameTooShort' }).max(120, { error: 'tooLong' }),
  email: emailSchema,
  password: newPasswordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { error: 'required' }).max(128, { error: 'tooLong' }),
    newPassword: newPasswordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { error: 'passwordSame', path: ['newPassword'] });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
