import type { Request } from 'express';
import { inject, injectable } from 'tsyringe';
import type { Env } from '../config/env.ts';
import { TOKENS } from '../container/tokens.ts';
import { cookieNames } from '../http/cookies.ts';
import type { Clock } from '../utils/clock.ts';
import { hmacSha256, randomToken, safeEqual, sha256Hex } from '../utils/crypto.ts';

/**
 * Token CSRF no padrão Signed Double-Submit Cookie da OWASP (plano §9.1–9.2):
 *
 *   payload = nonce.exp        token = payload.HMAC(CSRF_SECRET, binding|payload)
 *
 * O `binding` amarra o token à sessão (hash do cookie `sid`) ou, antes do login, à pré-sessão (`psid`). Não há escrita
 * no banco: a validação é só criptográfica. Ao logar ou deslogar o binding muda e os tokens antigos morrem sozinhos.
 */
@injectable()
export class CsrfService {
  constructor(
    @inject(TOKENS.Env) private readonly env: Env,
    @inject(TOKENS.Clock) private readonly clock: Clock,
  ) {}

  /** Binding da requisição atual: hash do token de sessão ou o id da pré-sessão (nunca consulta o banco). */
  bindingFor(req: Request): string | null {
    const names = cookieNames(this.env);
    const sid = req.cookies?.[names.session];
    if (typeof sid === 'string' && sid) return `s:${sha256Hex(sid)}`;
    const psid = req.cookies?.[names.preSession];
    if (typeof psid === 'string' && psid) return `p:${psid}`;
    return null;
  }

  bindingForSessionToken(sessionToken: string): string {
    return `s:${sha256Hex(sessionToken)}`;
  }

  bindingForPreSession(preSessionId: string): string {
    return `p:${preSessionId}`;
  }

  issue(binding: string): string {
    const exp = Math.floor(this.clock.now().getTime() / 1000) + this.env.CSRF_TTL_HOURS * 3600;
    const payload = `${randomToken(16)}.${exp}`;
    return `${payload}.${hmacSha256(this.env.CSRF_SECRET, `${binding}|${payload}`)}`;
  }

  verify(token: string | undefined, binding: string | null): boolean {
    if (!token || !binding) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [nonce, expRaw, signature] = parts as [string, string, string];
    const exp = Number(expRaw);
    if (!nonce || !Number.isInteger(exp) || exp * 1000 <= this.clock.now().getTime()) return false;
    return safeEqual(signature, hmacSha256(this.env.CSRF_SECRET, `${binding}|${nonce}.${expRaw}`));
  }
}
