import { useCallback, useSyncExternalStore } from 'react';

/**
 * Moeda SÓ na exibição (plano §14.4): o servidor manda centavos de BRL e a cobrança simulada é sempre em BRL.
 * USD e EUR são conversões aproximadas, com taxas FIXAS de demonstração, e aparecem com "≈".
 */
export const CURRENCIES = ['BRL', 'USD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Quanto vale 1 real em cada moeda (fixo, só para demonstração; não é cotação real). */
export const DEMO_RATES: Record<Currency, number> = { BRL: 1, USD: 0.18, EUR: 0.165 };

const STORAGE_KEY = 'favo.currency';
const listeners = new Set<() => void>();

function read(): Currency {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return CURRENCIES.includes(v as Currency) ? (v as Currency) : 'BRL';
  } catch {
    return 'BRL';
  }
}

export function useCurrency() {
  const currency = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => 'BRL' as Currency,
  );
  const setCurrency = useCallback((c: Currency) => {
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {}
    for (const l of listeners) l();
  }, []);
  return { currency, setCurrency };
}

/** Formata centavos de BRL na moeda e no idioma escolhidos; fora do BRL o valor vem com "≈". */
export function formatMoney(centsBrl: number, currency: Currency, locale: string): string {
  const value = (centsBrl / 100) * DEMO_RATES[currency];
  const text = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  return currency === 'BRL' ? text : `≈ ${text}`;
}

/** Sempre em BRL (o valor que é de fato cobrado). */
export function formatBrl(centsBrl: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL' }).format(centsBrl / 100);
}
