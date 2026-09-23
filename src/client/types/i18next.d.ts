import 'i18next';
import type account from '@/locales/pt-BR/account.json';
import type admin from '@/locales/pt-BR/admin.json';
import type auth from '@/locales/pt-BR/auth.json';
import type common from '@/locales/pt-BR/common.json';
import type errors from '@/locales/pt-BR/errors.json';

// Chaves tipadas: o pt-BR é a fonte da verdade, e t('chave.inexistente') não compila (plano §14.4).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof common; auth: typeof auth; account: typeof account; admin: typeof admin; errors: typeof errors };
  }
}
