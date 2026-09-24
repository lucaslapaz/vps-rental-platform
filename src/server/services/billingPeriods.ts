import type { Env } from '../config/env.ts';

const DAY_MS = 86_400_000;

type BillingEnv = Pick<Env, 'BILLING_PERIOD_DAYS' | 'BILLING_RENEWAL_NOTICE_DAYS' | 'BILLING_GRACE_DAYS' | 'BILLING_TIME_SCALE'>;

/** Prazos da cobrança recorrente (plano §12) em milissegundos, já divididos pelo "relógio acelerado" (BILLING_TIME_SCALE). */
export function billingDurations(env: BillingEnv) {
  const ms = (days: number) => Math.round((days * DAY_MS) / env.BILLING_TIME_SCALE);
  return {
    periodMs: ms(env.BILLING_PERIOD_DAYS),
    noticeMs: ms(env.BILLING_RENEWAL_NOTICE_DAYS),
    graceMs: ms(env.BILLING_GRACE_DAYS),
  };
}
