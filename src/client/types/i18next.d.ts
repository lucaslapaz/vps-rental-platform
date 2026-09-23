import 'i18next';
import type account from '@/locales/pt-BR/account.json';
import type admin from '@/locales/pt-BR/admin.json';
import type auth from '@/locales/pt-BR/auth.json';
import type billing from '@/locales/pt-BR/billing.json';
import type common from '@/locales/pt-BR/common.json';
import type errors from '@/locales/pt-BR/errors.json';
import type support from '@/locales/pt-BR/support.json';
import type vps from '@/locales/pt-BR/vps.json';

// Chaves tipadas: o pt-BR é a fonte da verdade, e t('chave.inexistente') não compila (plano §14.4).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      auth: typeof auth;
      account: typeof account;
      admin: typeof admin;
      errors: typeof errors;
      vps: typeof vps;
      billing: typeof billing;
      support: typeof support;
    };
  }
}
