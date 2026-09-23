import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import enAccount from '@/locales/en-US/account.json';
import enAdmin from '@/locales/en-US/admin.json';
import enAuth from '@/locales/en-US/auth.json';
import enBilling from '@/locales/en-US/billing.json';
import enCommon from '@/locales/en-US/common.json';
import enErrors from '@/locales/en-US/errors.json';
import enVps from '@/locales/en-US/vps.json';
import esAccount from '@/locales/es-ES/account.json';
import esAdmin from '@/locales/es-ES/admin.json';
import esAuth from '@/locales/es-ES/auth.json';
import esBilling from '@/locales/es-ES/billing.json';
import esCommon from '@/locales/es-ES/common.json';
import esErrors from '@/locales/es-ES/errors.json';
import esVps from '@/locales/es-ES/vps.json';
import ptAccount from '@/locales/pt-BR/account.json';
import ptAdmin from '@/locales/pt-BR/admin.json';
import ptAuth from '@/locales/pt-BR/auth.json';
import ptBilling from '@/locales/pt-BR/billing.json';
import ptCommon from '@/locales/pt-BR/common.json';
import ptErrors from '@/locales/pt-BR/errors.json';
import ptVps from '@/locales/pt-BR/vps.json';

/** Idiomas da interface (plano §14.4). O servidor, o banco e as VMs continuam em pt-BR/BRL. */
export const LANGUAGES = ['pt-BR', 'en-US', 'es-ES'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'pt-BR';

/** Um arquivo por área (namespace). O pt-BR é a fonte dos tipos (src/client/types/i18next.d.ts). */
export const resources = {
  'pt-BR': { common: ptCommon, auth: ptAuth, account: ptAccount, admin: ptAdmin, errors: ptErrors, vps: ptVps, billing: ptBilling },
  'en-US': { common: enCommon, auth: enAuth, account: enAccount, admin: enAdmin, errors: enErrors, vps: enVps, billing: enBilling },
  'es-ES': { common: esCommon, auth: esAuth, account: esAccount, admin: esAdmin, errors: esErrors, vps: esVps, billing: esBilling },
} as const;

/** Converte o idioma do navegador (ex.: "en-GB", "es") para um dos idiomas suportados. */
function toSupported(lng: string): Language {
  const lower = lng.toLowerCase();
  if (lower.startsWith('en')) return 'en-US';
  if (lower.startsWith('es')) return 'es-ES';
  return 'pt-BR';
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    defaultNS: 'common',
    ns: Object.keys(resources['pt-BR']),
    supportedLngs: LANGUAGES,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false }, // o React já escapa
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'favo.language',
      caches: ['localStorage'],
      convertDetectedLanguage: toSupported,
    },
  });

// <html lang> acompanha o idioma escolhido (leitores de tela, hifenização, Intl).
const syncHtmlLang = (lng: string) => document.documentElement.setAttribute('lang', lng);
syncHtmlLang(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE);
i18n.on('languageChanged', syncHtmlLang);

export default i18n;
