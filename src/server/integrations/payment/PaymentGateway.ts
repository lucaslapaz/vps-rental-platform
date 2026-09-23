/**
 * Contrato do gateway de pagamento (plano §12). A plataforma usa o FakePaymentGateway; trocar por um gateway real
 * (Stripe/Mercado Pago em modo teste) seria outra implementação, sem mexer nos services.
 */
export interface ChargeInput {
  amountCents: number;
  currency: 'BRL';
  description: string;
  card: { number: string; holder: string; expMonth: number; expYear: number; cvc: string };
  /** Idempotência: a mesma chave nunca cobra duas vezes. */
  idempotencyKey: string;
}

export type ChargeResult =
  | { status: 'APPROVED'; reference: string; brand: string; last4: string }
  | { status: 'DECLINED'; reference: string; brand: string; last4: string; failureCode: 'card_declined' | 'insufficient_funds' };

export interface PaymentGateway {
  charge(input: ChargeInput): Promise<ChargeResult>;
}
