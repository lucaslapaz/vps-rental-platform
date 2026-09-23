import { z } from 'zod';
import { POWER_ACTIONS } from '../constants/vps.ts';
import { expiryValid, luhnValid, onlyDigits } from '../utils/card.ts';
import { newPasswordSchema } from './auth.ts';

/** Usuários que o cliente não pode escolher: contas de sistema das imagens. */
export const RESERVED_USERNAMES = [
  'root',
  'daemon',
  'bin',
  'sys',
  'sync',
  'games',
  'man',
  'lp',
  'mail',
  'news',
  'uucp',
  'proxy',
  'www-data',
  'backup',
  'list',
  'irc',
  'nobody',
  'sshd',
  'messagebus',
  'systemd-network',
  'systemd-resolve',
  'systemd-timesync',
  'polkitd',
  'syslog',
  'adm',
  'wheel',
  'shutdown',
  'halt',
  'operator',
  'ftp',
  'postmaster',
  'lightdm',
  'chrony',
  'ntp',
] as const;

/** Nome de usuário Linux (plano §14.5): minúsculas, dígitos, _ e -, começando por letra ou _; até 32. */
export const vpsUsernameSchema = z
  .string()
  .trim()
  .regex(/^[a-z_][a-z0-9_-]{0,31}$/, { error: 'username' })
  .refine((u) => !(RESERVED_USERNAMES as readonly string[]).includes(u), { error: 'usernameReserved' });

/** Hostname = nome da VM no Proxmox e hostname da VPS (CLAUDE.md C5): um rótulo DNS válido. */
export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, { error: 'hostname' });

export const createVpsSchema = z
  .object({
    osTemplate: z.string().min(1, { error: 'required' }),
    plan: z.string().min(1, { error: 'required' }),
    hostname: hostnameSchema,
    username: vpsUsernameSchema,
    /** Chaves salvas na conta (ids) e/ou uma chave nova colada na hora. */
    sshKeyIds: z.array(z.coerce.number().int().positive()).max(10).default([]),
    newSshKey: z
      .object({
        publicKey: z.string().min(1, { error: 'required' }).max(16_384, { error: 'tooLong' }),
        name: z.string().trim().max(80, { error: 'tooLong' }).optional(),
        save: z.boolean().default(false),
      })
      .optional(),
    password: newPasswordSchema.optional(),
    sshPasswordAuth: z.boolean().default(false),
    rootPassword: newPasswordSchema.optional(),
  })
  .refine((v) => Boolean(v.password) || v.sshKeyIds.length > 0 || Boolean(v.newSshKey), { error: 'authMethodRequired', path: ['password'] })
  .refine((v) => !v.sshPasswordAuth || Boolean(v.password), { error: 'sshPasswordNeedsPassword', path: ['sshPasswordAuth'] });
export type CreateVpsInput = z.input<typeof createVpsSchema>;

/** Dados do cartão de teste. PAN e CVV nunca são gravados nem logados (plano §12). */
export const payInvoiceSchema = z
  .object({
    cardNumber: z.string().transform(onlyDigits).refine(luhnValid, { error: 'cardNumber' }),
    holder: z.string().trim().min(2, { error: 'required' }).max(80, { error: 'tooLong' }),
    expMonth: z.coerce.number().int().min(1, { error: 'cardExpiry' }).max(12, { error: 'cardExpiry' }),
    expYear: z.coerce.number().int().min(0, { error: 'cardExpiry' }).max(2100, { error: 'cardExpiry' }),
    cvc: z.string().regex(/^\d{3,4}$/, { error: 'cardCvc' }),
  })
  .refine((v) => expiryValid(v.expMonth, v.expYear), { error: 'cardExpired', path: ['expMonth'] });
export type PayInvoiceInput = z.input<typeof payInvoiceSchema>;

/** POST /api/vps/:id/actions/:action */
export const vpsActionParamsSchema = z.object({ id: z.uuid({ error: 'id' }), action: z.enum(POWER_ACTIONS, { error: 'action' }) });

/** POST /api/vps/:id/resize: troca para outro plano (sem diminuir o disco). */
export const resizeVpsSchema = z.object({ plan: z.string().min(1, { error: 'required' }) });
