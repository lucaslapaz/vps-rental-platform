import argon2 from 'argon2';

/** Hash de senha com argon2id (plano §9.3). Os parâmetros ficam no próprio hash, então podem mudar no futuro. */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}
