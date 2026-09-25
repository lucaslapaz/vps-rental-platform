// Cria ou completa os arquivos .env.development e .env.test (e, com --production, o .env.production) de uma instalação
// nova (docs/instalacao.md). Nunca troca um valor que já existe: só acrescenta as variáveis que faltam.
//
//   node scripts/setup/env.mjs '<senha do usuário vps_app do MySQL>' [--production]
//
// - Segredos (CSRF_SECRET, JOB_SECRET_KEY, senha dos usuários de demonstração) são gerados aleatoriamente.
// - As variáveis PVE_* vêm do scripts/pve/bootstrap.sh, que grava no .env.development; este script as copia para os
//   outros arquivos. Rodar de novo depois do bootstrap completa o que faltou.
// Node puro, sem dependências (roda antes do npm install).
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const production = args.includes('--production');
const password = args.find((a) => !a.startsWith('--'));
if (!password) {
  console.error("uso: node scripts/setup/env.mjs '<senha do vps_app no MySQL>' [--production]");
  process.exit(2);
}

const MYSQL = process.env.MYSQL_HOST ?? '127.0.0.1:3306';
const dbUrl = (db) => `mysql://vps_app:${encodeURIComponent(password)}@${MYSQL}/${db}`;
const secret = (bytes) => randomBytes(bytes).toString('base64url');
const PVE_KEYS = ['PVE_URL', 'PVE_NODE', 'PVE_TLS_SERVERNAME', 'PVE_CA_FILE', 'PVE_TOKEN_ID', 'PVE_TOKEN_SECRET'];

/** Lê KEY=valor (ignora comentários e linhas vazias). */
function read(file) {
  if (!existsSync(file)) return new Map();
  return new Map(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

/** Acrescenta ao arquivo só as chaves que ainda não existem; devolve o que foi acrescentado. */
function complete(file, wanted) {
  const current = read(file);
  const added = Object.entries(wanted).filter(([k, v]) => v !== undefined && !current.has(k));
  if (added.length) {
    const before = existsSync(file) ? readFileSync(file, 'utf8') : `# ${file} (fora do git). Modelo comentado: .env.example\n`;
    const sep = before === '' || before.endsWith('\n') ? '' : '\n';
    writeFileSync(file, `${before}${sep}${added.map(([k, v]) => `${k}=${v}`).join('\n')}\n`, { mode: 0o600 });
  }
  const kept = Object.keys(wanted).filter((k) => current.has(k));
  console.log(`${file}: ${added.length ? `acrescentado ${added.map(([k]) => k).join(', ')}` : 'nada a acrescentar'}`);
  if (kept.length) console.log(`  (mantidos como estavam: ${kept.join(', ')})`);
  return added.map(([k]) => k);
}

const dev = read('.env.development');
const pve = Object.fromEntries(PVE_KEYS.map((k) => [k, dev.get(k)]));

complete('.env.development', {
  DATABASE_URL: dbUrl('vps_platform_dev'),
  SHADOW_DATABASE_URL: dbUrl('vps_platform_shadow'),
  SEED_DEFAULT_PASSWORD: secret(12),
  CSRF_SECRET: secret(48),
  JOB_SECRET_KEY: randomBytes(32).toString('base64'),
});

// Os testes usam a mesma senha de demonstração do dev (mais fácil de lembrar) e o mesmo Proxmox (só o npm run test:lab o usa).
complete('.env.test', {
  DATABASE_URL: dbUrl('vps_platform_test'),
  SEED_DEFAULT_PASSWORD: read('.env.development').get('SEED_DEFAULT_PASSWORD'),
  CSRF_SECRET: secret(48),
  JOB_SECRET_KEY: randomBytes(32).toString('base64'),
  ...pve,
});

if (production) {
  const adminPassword = secret(15);
  const added = complete('.env.production', {
    DATABASE_URL: dbUrl('vps_platform_prod'),
    SEED_ADMIN_EMAIL: 'admin@favo.local',
    SEED_ADMIN_PASSWORD: adminPassword,
    CSRF_SECRET: secret(48),
    JOB_SECRET_KEY: randomBytes(32).toString('base64'),
    ...pve,
  });
  if (added.includes('SEED_ADMIN_PASSWORD'))
    console.log(`  admin de produção: admin@favo.local (senha em SEED_ADMIN_PASSWORD no .env.production)`);
}

const missing = PVE_KEYS.filter((k) => !pve[k]);
if (missing.length) {
  console.log(
    `\nAinda faltam as variáveis do Proxmox (${missing.join(', ')}): rode scripts/pve/bootstrap.sh e depois este script de novo.`,
  );
} else {
  console.log('\nVariáveis do Proxmox presentes. Senha dos usuários de demonstração: SEED_DEFAULT_PASSWORD no .env.development.');
}
