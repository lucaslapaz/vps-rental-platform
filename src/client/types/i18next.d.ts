import 'i18next';
import type ptBR from '@/locales/pt-BR/common.json';

// Chaves tipadas: o pt-BR é a fonte da verdade, e t('chave.inexistente') não compila (plano §14.4).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: { common: typeof ptBR };
  }
}
