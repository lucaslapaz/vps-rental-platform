import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = 'src/client/locales';
const LANGUAGES = ['pt-BR', 'en-US', 'es-ES'];
const NAMESPACES = readdirSync(join(ROOT, 'pt-BR')).filter((f) => f.endsWith('.json'));

const load = (lng: string, ns: string) => JSON.parse(readFileSync(join(ROOT, lng, ns), 'utf8')) as object;

/** Lista as chaves "a.b.c" de um objeto de traduções, com o valor de cada uma. */
function flatten(obj: object, prefix = ''): [string, unknown][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v] as [string, unknown]],
  );
}

describe('traduções', () => {
  it('existe o mesmo conjunto de arquivos (namespaces) em todos os idiomas', () => {
    for (const lng of LANGUAGES) expect(readdirSync(join(ROOT, lng)).sort()).toEqual([...NAMESPACES].sort());
  });

  for (const ns of NAMESPACES) {
    it.each(LANGUAGES.slice(1))(`${ns}: %s tem exatamente as mesmas chaves do pt-BR`, (lng) => {
      const keys = (o: object) =>
        flatten(o)
          .map(([k]) => k)
          .sort();
      expect(keys(load(lng, ns))).toEqual(keys(load('pt-BR', ns)));
    });
  }

  it('nenhuma tradução está vazia e as interpolações {{…}} batem entre os idiomas', () => {
    for (const ns of NAMESPACES) {
      const base = new Map(flatten(load('pt-BR', ns)));
      for (const lng of LANGUAGES) {
        for (const [key, value] of flatten(load(lng, ns))) {
          expect(typeof value === 'string' && value.trim().length > 0, `${lng}/${ns}: ${key}`).toBe(true);
          const vars = (v: unknown) => [...String(v).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
          expect(vars(value), `${lng}/${ns}: ${key}`).toEqual(vars(base.get(key)));
        }
      }
    }
  });
});
