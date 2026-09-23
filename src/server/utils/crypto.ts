import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token aleatório em base64url (32 bytes = 256 bits por padrão). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 em hexadecimal (64 caracteres). É o que fica no banco no lugar do token da sessão (plano §9.4). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/** Comparação em tempo constante (não vaza, pelo tempo de resposta, quantos caracteres batem). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
