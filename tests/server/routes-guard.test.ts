import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Regressão da revisão de segurança (Fase 9): TODA rota que altera dados passa por originCheck (O) e CSRF (C) e, fora
 * cadastro e login, por autenticação (A). Uma rota nova sem essas camadas quebra este teste antes de chegar ao ar.
 */
describe('rotas que alteram dados (plano §9.5)', () => {
  const source = readFileSync('src/server/http/routes/index.ts', 'utf8');
  const calls = [...source.matchAll(/router\.(post|put|patch|delete)\(([\s\S]*?)\);/g)].map(([, verb, args]) => {
    const parts = (args as string).split(',').map((p) => p.trim());
    return { verb: verb as string, path: parts[0] as string, parts };
  });

  it('encontra as rotas (o parser acompanha o arquivo)', () => {
    expect(calls.length).toBeGreaterThanOrEqual(20);
  });

  it.each(calls.map((c) => [`${c.verb.toUpperCase()} ${c.path}`, c] as const))('%s tem originCheck, CSRF e autenticação', (_name, c) => {
    expect(c.parts).toContain('O');
    expect(c.parts).toContain('C');
    const isPublic = /auth\/(register|login)/.test(c.path);
    if (!isPublic) expect(c.parts).toContain('A');
    // A ordem importa: origem e CSRF antes de autenticar (plano §9.5).
    expect(c.parts.indexOf('O')).toBeLessThan(c.parts.indexOf('C'));
  });
});
