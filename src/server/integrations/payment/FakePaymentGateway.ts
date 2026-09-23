import { createHash } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import { cardBrand, onlyDigits } from '../../../shared/utils/card.ts';
import type { Env } from '../../config/env.ts';
import { TOKENS } from '../../container/tokens.ts';
import type { ChargeInput, ChargeResult, PaymentGateway } from './PaymentGateway.ts';

/**
 * Gateway SIMULADO (plano §12): nenhuma cobrança real. Cartões de teste:
 * 4242 4242 4242 4242 → aprovado · 4000 0000 0000 0002 → recusado (card_declined) ·
 * 4000 0000 0000 9995 → saldo insuficiente · qualquer outro com Luhn válido → aprovado.
 * Latência artificial de 1–2 s (configurável). Só a bandeira e os 4 últimos dígitos saem daqui.
 */
@injectable()
export class FakePaymentGateway implements PaymentGateway {
  private readonly seen = new Map<string, ChargeResult>();

  constructor(@inject(TOKENS.Env) private readonly env: Env) {}

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const previous = this.seen.get(input.idempotencyKey);
    if (previous) return previous;

    const latency = this.env.PAYMENT_LATENCY_MS ?? (this.env.NODE_ENV === 'test' ? 0 : 1000 + Math.floor(Math.random() * 1000));
    if (latency) await new Promise((r) => setTimeout(r, latency));

    const number = onlyDigits(input.card.number);
    const common = {
      reference: `fake_${createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 24)}`,
      brand: cardBrand(number),
      last4: number.slice(-4),
    };
    const result: ChargeResult =
      number === '4000000000000002'
        ? { status: 'DECLINED', failureCode: 'card_declined', ...common }
        : number === '4000000000009995'
          ? { status: 'DECLINED', failureCode: 'insufficient_funds', ...common }
          : { status: 'APPROVED', ...common };
    this.seen.set(input.idempotencyKey, result);
    return result;
  }
}
