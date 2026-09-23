// Maior versão ESTÁVEL de cada pacote (plano §4.1). A tag `latest` do npm não é critério: ela pode apontar para uma
// pré-release (caso real: prisma → 8.0.0-rc.x).
//
//   npm run deps:stable -- <pacote> [<pacote>...]
//
// Estável = versão publicada no formato X.Y.Z, sem sufixo (-rc, -beta, -dev…). Node puro, sem dependências.
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function compareSemver(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export function npmView(pkg, fields) {
  // No Windows o npm é um .cmd e precisa de shell; por isso o nome é validado antes de entrar no comando.
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(pkg)) throw new Error(`nome de pacote inválido: ${pkg}`);
  const out = execSync(`npm view ${pkg} ${fields.join(' ')} --json`, { encoding: 'utf8' });
  return JSON.parse(out);
}

export function highestStable(pkg) {
  const info = npmView(pkg, ['dist-tags', 'versions', 'time']);
  const versions = Array.isArray(info.versions) ? info.versions : [info.versions];
  const stable = versions.filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort(compareSemver);
  const max = stable.at(-1);
  return { pkg, latest: info['dist-tags']?.latest, stable: max, publishedAt: info.time?.[max]?.slice(0, 10) };
}

// Executado como script (e não importado pelo check-installed.mjs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkgs = process.argv.slice(2);
  if (pkgs.length === 0) {
    console.error('uso: npm run deps:stable -- <pacote> [<pacote>...]');
    process.exit(2);
  }
  let failed = false;
  for (const pkg of pkgs) {
    try {
      const r = highestStable(pkg);
      const note = r.latest === r.stable ? 'OK' : '<< latest NÃO é a maior estável';
      console.log(`${pkg.padEnd(40)} maior estável=${String(r.stable).padEnd(10)} (${r.publishedAt})  latest=${r.latest}  ${note}`);
    } catch (err) {
      failed = true;
      console.error(`${pkg}: erro ao consultar o registro (${err.message.split('\n')[0]})`);
    }
  }
  process.exit(failed ? 1 : 0);
}
