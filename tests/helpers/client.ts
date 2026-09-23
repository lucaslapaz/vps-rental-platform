import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request, { type Response } from 'supertest';
import { loadSeedEnv } from '../../prisma/seed/env.ts';

/** Senha dos usuários de demonstração do banco de teste (SEED_DEFAULT_PASSWORD do .env.test). */
export const seedPassword = () => loadSeedEnv().SEED_DEFAULT_PASSWORD as string;

export const uniqueEmail = (prefix = 'teste') => `${prefix}-${randomUUID().slice(0, 8)}@favo.local`;

/**
 * Cliente HTTP que se comporta como o navegador da SPA: guarda os cookies (agent do supertest), lê o cookie `csrf`
 * de cada resposta e o devolve no header X-CSRF-Token (padrão cookie-to-header, plano §9.2).
 */
export class TestClient {
  readonly agent;
  csrfToken: string | undefined;
  cookies = new Map<string, string>();

  constructor(app: Express) {
    this.agent = request.agent(app);
  }

  private track(res: Response) {
    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    for (const c of setCookie ?? []) {
      const [pair = ''] = c.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(c)) this.cookies.delete(name);
      else this.cookies.set(name, value);
      if (name === 'csrf') this.csrfToken = value;
    }
    return res;
  }

  /** Obtém psid + csrf, como faz o HTML da SPA ao ser servido. */
  async init() {
    return this.track(await this.agent.get('/api/auth/csrf'));
  }

  async get(path: string) {
    return this.track(await this.agent.get(path));
  }

  async send(method: 'post' | 'put' | 'patch' | 'delete', path: string, body?: object, headers: Record<string, string> = {}) {
    let req = this.agent[method](path).set('Origin', 'http://localhost:3000');
    if (this.csrfToken) req = req.set('X-CSRF-Token', this.csrfToken);
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return this.track(await (body ? req.send(body) : req));
  }

  async login(email: string, password = seedPassword()) {
    if (!this.csrfToken) await this.init();
    return this.send('post', '/api/auth/login', { email, password });
  }
}

/** Gera uma chave pública OpenSSH ed25519 válida (blob: string "ssh-ed25519" + string com os 32 bytes da chave). */
export function generateSshPublicKey(comment = 'teste@favo') {
  const { publicKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url');
  const str = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
  const blob = Buffer.concat([str(Buffer.from('ssh-ed25519')), str(raw)]);
  return `ssh-ed25519 ${blob.toString('base64')} ${comment}`;
}
