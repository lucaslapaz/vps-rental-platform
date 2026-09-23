/** Utilitários do cartão de teste (pagamento simulado, plano §12). Usados no formulário e no servidor. */

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** Algoritmo de Luhn (dígito verificador de cartões). */
export function luhnValid(number: string): boolean {
  const digits = onlyDigits(number);
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export type CardBrand = 'visa' | 'mastercard' | 'amex' | 'elo' | 'unknown';

export function cardBrand(number: string): CardBrand {
  const d = onlyDigits(number);
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d)) return 'elo';
  if (/^4/.test(d)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return 'mastercard';
  if (/^3[47]/.test(d)) return 'amex';
  return 'unknown';
}

/** Validade MM/AA ainda não vencida (o cartão vale até o fim do mês). */
export function expiryValid(month: number, year: number, now = new Date()): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const fullYear = year < 100 ? 2000 + year : year;
  const endOfMonth = new Date(fullYear, month, 1); // 1º dia do mês seguinte
  return endOfMonth > now;
}

/** Cartões de teste mostrados na tela de checkout (plano §12). */
export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', outcome: 'approved' },
  { number: '4000 0000 0000 0002', outcome: 'card_declined' },
  { number: '4000 0000 0000 9995', outcome: 'insufficient_funds' },
] as const;
