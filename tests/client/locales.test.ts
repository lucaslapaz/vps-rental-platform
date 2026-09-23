import { describe, expect, it } from 'vitest';
import enUS from '../../src/client/locales/en-US/common.json' with { type: 'json' };
import esES from '../../src/client/locales/es-ES/common.json' with { type: 'json' };
import ptBR from '../../src/client/locales/pt-BR/common.json' with { type: 'json' };

/** Lista as chaves "a.b.c" de um objeto de traduções. */
function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('traduções', () => {
  const base = keys(ptBR).sort();

  it.each([
    ['en-US', enUS],
    ['es-ES', esES],
  ])('%s tem exatamente as mesmas chaves do pt-BR', (_lng, dict) => {
    expect(keys(dict).sort()).toEqual(base);
  });

  it('nenhuma tradução está vazia', () => {
    for (const dict of [ptBR, enUS, esES]) {
      const flat = keys(dict).map((k) => k.split('.').reduce<unknown>((o, p) => (o as Record<string, unknown>)[p], dict));
      expect(flat.every((v) => typeof v === 'string' && v.trim().length > 0)).toBe(true);
    }
  });
});
