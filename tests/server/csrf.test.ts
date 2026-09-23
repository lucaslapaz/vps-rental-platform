import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/server/config/env.ts';
import { CsrfService } from '../../src/server/services/CsrfService.ts';

describe('CsrfService (Signed Double-Submit Cookie)', () => {
  let now = new Date('2026-09-23T12:00:00Z');
  const env = { CSRF_SECRET: 'x'.repeat(40), CSRF_TTL_HOURS: 12 } as Env;
  const csrf = new CsrfService(env, { now: () => now });
  const binding = 's:abc';

  it('aceita um token válido para o mesmo binding', () => {
    expect(csrf.verify(csrf.issue(binding), binding)).toBe(true);
  });

  it('recusa token de outro binding (outra sessão ou pré-sessão)', () => {
    expect(csrf.verify(csrf.issue(binding), 's:outra')).toBe(false);
    expect(csrf.verify(csrf.issue('p:visitante'), binding)).toBe(false);
  });

  it('recusa token expirado', () => {
    const token = csrf.issue(binding);
    now = new Date(now.getTime() + 12 * 3600 * 1000 + 1000);
    expect(csrf.verify(token, binding)).toBe(false);
  });

  it('recusa token ausente, malformado ou com assinatura adulterada', () => {
    const token = csrf.issue(binding);
    expect(csrf.verify(undefined, binding)).toBe(false);
    expect(csrf.verify(token, null)).toBe(false);
    expect(csrf.verify('a.b', binding)).toBe(false);
    const [nonce, exp] = token.split('.');
    expect(csrf.verify(`${nonce}.${Number(exp) + 3600}.${token.split('.')[2]}`, binding)).toBe(false); // exp adulterado
    expect(csrf.verify(`${token.slice(0, -2)}xx`, binding)).toBe(false);
  });

  it('recusa token assinado com outro segredo', () => {
    const other = new CsrfService({ ...env, CSRF_SECRET: 'y'.repeat(40) }, { now: () => now });
    expect(csrf.verify(other.issue(binding), binding)).toBe(false);
  });
});
