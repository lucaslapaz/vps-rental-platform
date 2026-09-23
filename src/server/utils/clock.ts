/** Fonte de tempo injetável, para que testes controlem "agora" (expiração de sessão, CSRF, jobs). */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
