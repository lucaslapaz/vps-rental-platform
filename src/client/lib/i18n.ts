import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import enUS from '@/locales/en-US/common.json';
import esES from '@/locales/es-ES/common.json';
import ptBR from '@/locales/pt-BR/common.json';

/** Idiomas da interface (plano §14.4). O servidor, o banco e as VMs continuam em pt-BR/BRL. */
export const LANGUAGES = ['pt-BR', 'en-US', 'es-ES'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'pt-BR';

export const resources = {
  'pt-BR': { common: ptBR },
  'en-US': { common: enUS },
  'es-ES': { common: esES },
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
    ns: ['common'],
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
