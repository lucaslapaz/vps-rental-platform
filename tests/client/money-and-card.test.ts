import { describe, expect, it } from 'vitest';
import { formatBrl, formatMoney } from '../../src/client/lib/currency.ts';
import { cardBrand, expiryValid, luhnValid } from '../../src/shared/utils/card.ts';

describe('cartão de teste', () => {
  it('Luhn: aceita os cartões de teste e recusa um dígito trocado', () => {
    for (const n of ['4242 4242 4242 4242', '4000000000000002', '4000 0000 0000 9995', '5555555555554444']) expect(luhnValid(n)).toBe(true);
    expect(luhnValid('4242 4242 4242 4241')).toBe(false);
    expect(luhnValid('1234')).toBe(false);
  });

  it('bandeira e validade', () => {
    expect(cardBrand('4242424242424242')).toBe('visa');
    expect(cardBrand('5555555555554444')).toBe('mastercard');
    expect(cardBrand('378282246310005')).toBe('amex');
    const now = new Date('2026-09-23T12:00:00Z');
    expect(expiryValid(9, 26, now)).toBe(true); // vale até o fim do mês
    expect(expiryValid(8, 26, now)).toBe(false);
    expect(expiryValid(13, 30, now)).toBe(false);
  });
});

describe('moeda só na exibição (§14.4)', () => {
  it('BRL sem "≈"; USD e EUR convertidos e com "≈"', () => {
    expect(formatBrl(990, 'pt-BR')).toBe('R$ 9,90');
    expect(formatMoney(990, 'BRL', 'pt-BR')).toBe('R$ 9,90');
    expect(formatMoney(990, 'USD', 'en-US')).toBe('≈ $1.78');
    expect(formatMoney(1000, 'EUR', 'es-ES')).toMatch(/^≈ 1,65\s€$/);
  });
});
