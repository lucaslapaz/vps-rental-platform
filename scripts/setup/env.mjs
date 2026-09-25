// Cria ou completa os arquivos .env.development e .env.test (e, com --production, o .env.production) de uma instalação
// (docs/instalacao.md, docs/variaveis-de-ambiente.md).
//
//   npm run env:setup                       # pergunta a senha do vps_app do MySQL (só se faltar alguma DATABASE_URL)
//   npm run env:setup -- --production       # também o .env.production
//   node scripts/setup/env.mjs '<senha>'    # a senha como argumento (cuidado com caracteres especiais no shell)
//
// - Nunca troca um valor que já existe: só acrescenta as variáveis que faltam. Os segredos são gerados aleatoriamente.
// - Exceção: as PVE_* (gravadas no .env.development pelo scripts/pve/bootstrap.sh) são SEMPRE copiadas do
//   .env.development para os outros arquivos, para que um --rotate-token não deixe um secret antigo no .env.test.
// Node puro, sem dependências (roda antes do npm install).
import { createInterface } from 'node:readline';
import { envFile, PVE_KEYS, readEnv, SECRETS, setEnv } from './lib.mjs';

const args = process.argv.slice(2);
const production = args.includes('--production');
// A senha só é necessária para montar as DATABASE_URL que ainda faltam (rodar de novo depois do bootstrap não pergunta).
const needsPassword =
  !readEnv(envFile('development')).has('DATABASE_URL') ||
  !readEnv(envFile('development')).has('SHADOW_DATABASE_URL') ||
  !readEnv(envFile('test')).has('DATABASE_URL') ||
  (production && !readEnv(envFile('production')).has('DATABASE_URL'));
const password = args.find((a) => !a.startsWith('--')) ?? (needsPassword ? await askPassword() : '');
if (needsPassword && !password) {
  console.error('Informe a senha do usuário vps_app do MySQL (docs/instalacao.md, passo C3).');
  process.exit(2);
}

const MYSQL = process.env.MYSQL_HOST ?? '127.0.0.1:3306';
const dbUrl = (db) => `mysql://vps_app:${encodeURIComponent(password)}@${MYSQL}/${db}`;
const gen = (key) => SECRETS[key].generate();

/** Acrescenta só as chaves que faltam no arquivo e informa o que fez. */
function complete(file, wanted) {
  const current = readEnv(file);
  const added = Object.keys(wanted).filter((k) => wanted[k] !== undefined && !current.has(k));
  for (const k of added) setEnv(file, k, wanted[k]);
  const kept = Object.keys(wanted).filter((k) => current.has(k));
  console.log(`${file}: ${added.length ? `acrescentado ${added.join(', ')}` : 'nada a acrescentar'}`);
  if (kept.length) console.log(`  (mantidos como estavam: ${kept.join(', ')})`);
  return added;
}

/** Copia as PVE_* do .env.development (substitui valores antigos). */
function syncPve(file, pve) {
  const current = readEnv(file);
  const changed = PVE_KEYS.filter((k) => pve[k] && current.get(k) !== pve[k]);
  for (const k of changed) setEnv(file, k, pve[k]);
  if (changed.length) console.log(`  PVE_* copiadas do .env.development: ${changed.join(', ')}`);
}

complete(envFile('development'), {
  DATABASE_URL: dbUrl('vps_platform_dev'),
  SHADOW_DATABASE_URL: dbUrl('vps_platform_shadow'),
  SEED_DEFAULT_PASSWORD: gen('SEED_DEFAULT_PASSWORD'),
  CSRF_SECRET: gen('CSRF_SECRET'),
  JOB_SECRET_KEY: gen('JOB_SECRET_KEY'),
});
const dev = readEnv(envFile('development'));
const pve = Object.fromEntries(PVE_KEYS.map((k) => [k, dev.get(k)]));

// Os testes usam a mesma senha de demonstração do dev (mais fácil de lembrar) e o mesmo Proxmox (só o npm run test:lab o usa).
complete(envFile('test'), {
  DATABASE_URL: dbUrl('vps_platform_test'),
  SEED_DEFAULT_PASSWORD: dev.get('SEED_DEFAULT_PASSWORD'),
  CSRF_SECRET: gen('CSRF_SECRET'),
  JOB_SECRET_KEY: gen('JOB_SECRET_KEY'),
});
syncPve(envFile('test'), pve);

if (production) {
  const added = complete(envFile('production'), {
    DATABASE_URL: dbUrl('vps_platform_prod'),
    SEED_ADMIN_EMAIL: 'admin@favo.local',
    SEED_ADMIN_PASSWORD: gen('SEED_ADMIN_PASSWORD'),
    CSRF_SECRET: gen('CSRF_SECRET'),
    JOB_SECRET_KEY: gen('JOB_SECRET_KEY'),
  });
  syncPve(envFile('production'), pve);
  if (added.includes('SEED_ADMIN_PASSWORD'))
    console.log('  admin de produção: admin@favo.local (senha em SEED_ADMIN_PASSWORD no .env.production)');
}

const missing = PVE_KEYS.filter((k) => !pve[k]);
if (missing.length) {
  console.log(
    `\nAinda faltam as variáveis do Proxmox (${missing.join(', ')}): rode scripts/pve/bootstrap.sh no Git Bash e depois\nnpm run env:setup de novo.`,
  );
} else {
  console.log('\nVariáveis do Proxmox presentes. Senha dos usuários de demonstração: SEED_DEFAULT_PASSWORD no .env.development.');
}

/** Pergunta a senha no terminal (sem eco quando o terminal permite). */
function askPassword() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    let muted = false;
    const write = rl._writeToOutput?.bind(rl);
    if (process.stdin.isTTY && write) rl._writeToOutput = (s) => write(muted ? '' : s);
    rl.on('close', () => resolve('')); // entrada encerrada sem resposta
    rl.question('Senha do usuário vps_app do MySQL: ', (answer) => {
      if (muted) process.stdout.write('\n');
      resolve(answer.trim());
      rl.close();
    });
    muted = true;
  });
}
