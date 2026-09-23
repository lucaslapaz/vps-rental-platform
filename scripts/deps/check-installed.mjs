// Confere TODAS as dependências diretas do package.json contra a maior versão estável (plano §4.1, item 7).
// Falha (código 1) se alguma estiver instalada numa pré-release, atrás da maior estável ou sem versão exata.
//
//   npm run deps:check
//
// Use depois de CLIs que instalam pacotes por conta própria (ex.: `npx shadcn@<versão> add …`).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compareSemver, highestStable } from './stable-versions.mjs';

const pkgJson = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

let installed = {};
try {
  const out = execSync('npm ls --depth=0 --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  installed = JSON.parse(out).dependencies ?? {};
} catch (err) {
  // `npm ls` sai com código != 0 se houver problemas na árvore, mas ainda imprime o JSON.
  installed = JSON.parse(err.stdout || '{}').dependencies ?? {};
}

const problems = [];
for (const [name, range] of Object.entries(declared).sort(([a], [b]) => a.localeCompare(b))) {
  const version = installed[name]?.version;
  const { stable } = highestStable(name);
  let status = 'OK';
  if (!/^\d+\.\d+\.\d+$/.test(range)) status = `versão não exata no package.json ("${range}")`;
  else if (!version) status = 'não instalado';
  else if (!/^\d+\.\d+\.\d+$/.test(version)) status = `pré-release instalada (${version})`;
  else if (compareSemver(version, stable) < 0) status = `atrás da maior estável (${version} < ${stable})`;
  else if (compareSemver(version, stable) > 0) status = `acima da maior estável?! (${version} > ${stable})`;
  if (status !== 'OK') problems.push(name);
  console.log(`${status === 'OK' ? '✅' : '❌'} ${name.padEnd(40)} ${String(version).padEnd(10)} ${status === 'OK' ? '' : status}`);
}

if (problems.length) {
  console.error(`\n${problems.length} dependência(s) fora da regra. Corrija com: npm install <pacote>@<maior estável>`);
  process.exit(1);
}
console.log(`\nTodas as ${Object.keys(declared).length} dependências diretas estão na maior versão estável.`);
