import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifra segredos que precisam atravessar a fila de jobs (senha do usuário e do root da VPS) com AES-256-GCM
 * (plano §10.6). Formato: "v1.<iv>.<tag>.<ciphertext>" em base64url. A chave é a JOB_SECRET_KEY (32 bytes).
 * O payload cifrado é apagado assim que o job usa a senha: ela nunca fica em texto puro no banco.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('JOB_SECRET_KEY precisa ter 32 bytes');
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  /** Lança erro se o texto foi adulterado ou cifrado com outra chave (a tag do GCM não confere). */
  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('segredo em formato inválido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
