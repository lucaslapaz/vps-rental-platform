// Assistente que cria ou completa os arquivos .env.development e .env.test (e, se pedido, o .env.production)
// (docs/instalacao.md, docs/variaveis-de-ambiente.md).
//
//   npm run env:setup                          # faz as perguntas no console (Enter aceita o padrão)
//   npm run env:setup -- --production          # inclui o .env.production sem perguntar
//   npm run env:setup -- --yes                 # sem perguntas: padrões + senha do MySQL em DB_PASSWORD ou no argumento
//
// - Só pergunta o que é escolha do usuário (MySQL, senha de demonstração, porta, cobrança acelerada, admin de produção).
//   Segredos (CSRF_SECRET, JOB_SECRET_KEY) são gerados sem perguntar. As PVE_* vêm do scripts/pve/bootstrap.sh.
// - Nunca troca um valor que já existe: só acrescenta o que falta (rodar de novo não pergunta o que já está preenchido).
// - As PVE_* do .env.development são SEMPRE copiadas para os outros arquivos (um --rotate-token não deixa secret antigo).
// - Testa a senha do MySQL e confere se os bancos existem antes de gravar (usa o driver mariadb, se instalado).
import { createInterface } from 'node:readline';
import { envFile, PVE_KEYS, readEnv, SECRETS, setEnv } from './lib.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const argPassword = args.find((a) => !a.startsWith('--')) ?? process.env.DB_PASSWORD;
const auto = flags.has('--yes');

const DB = { development: 'vps_platform_dev', test: 'vps_platform_test', production: 'vps_platform_prod', shadow: 'vps_platform_shadow' };
const files = { development: envFile('development'), test: envFile('test'), production: envFile('production') };
const cur = { development: readEnv(files.development), test: readEnv(files.test), production: readEnv(files.production) };
const firstRun = !cur.development.has('DATABASE_URL');

const prompt = auto ? null : createPrompter();
const answers = {};

console.log('Configuração dos arquivos .env da Favo. Enter aceita o valor entre colchetes; Ctrl+C cancela.');
console.log('Segredos e tokens são gerados automaticamente. Detalhes: docs/variaveis-de-ambiente.md\n');

// ── MySQL: reaproveita o que já está no .env.development; senão pergunta ──
let creds = cur.development.has('DATABASE_URL') ? parseDbUrl(cur.development.get('DATABASE_URL')) : null;
if (!creds) {
  creds = {
    host: await ask('MySQL: endereço', '127.0.0.1:3306', (v) => /^[\w.-]+(:\d{1,5})?$/.test(v) || 'use host ou host:porta'),
    user: await ask('MySQL: usuário da aplicação', 'vps_app', (v) => /^\S+$/.test(v) || 'sem espaços'),
    password: '',
  };
  creds.password = await askDbPassword(creds);
}

// ── Escolhas feitas só na primeira vez ──
if (!cur.development.has('SEED_DEFAULT_PASSWORD')) {
  answers.demoPassword = await ask(
    'Senha dos usuários de demonstração (ana@favo.local e os outros)',
    'Enter = gerar uma aleatória',
    (v) => v.length >= 10 || 'mínimo 10 caracteres',
    { secret: true, generated: () => SECRETS.SEED_DEFAULT_PASSWORD.generate() },
  );
}
if (firstRun) {
  answers.port = await ask(
    'Porta do servidor de desenvolvimento',
    '3000',
    (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 65535) || 'número de 1 a 65535',
  );
  answers.fastBilling = await confirm('Acelerar a cobrança recorrente para demonstração (um mês em 30 minutos)?', false);
}
const production = flags.has('--production') || (firstRun && (await confirm('Criar também o .env.production (npm start)?', false)));
if (production && !cur.production.has('SEED_ADMIN_EMAIL')) {
  answers.adminEmail = await ask(
    'Produção: e-mail do administrador',
    'admin@favo.local',
    (v) => /^[^\s@]+@[^\s@]+$/.test(v) || 'e-mail inválido',
  );
}
if (production && !cur.production.has('SEED_ADMIN_PASSWORD')) {
  answers.adminPassword = await ask(
    'Produção: senha do administrador',
    'Enter = gerar uma aleatória',
    (v) => v.length >= 12 || 'mínimo 12 caracteres',
    {
      secret: true,
      generated: () => SECRETS.SEED_ADMIN_PASSWORD.generate(),
    },
  );
}

// ── O que vai ser gravado ──
const url = (db) => `mysql://${encodeURIComponent(creds.user)}:${encodeURIComponent(creds.password)}@${creds.host}/${db}`;
const gen = (key) => SECRETS[key].generate();
const plan = {
  development: {
    DATABASE_URL: url(DB.development),
    SHADOW_DATABASE_URL: url(DB.shadow),
    SEED_DEFAULT_PASSWORD: answers.demoPassword,
    CSRF_SECRET: gen('CSRF_SECRET'),
    JOB_SECRET_KEY: gen('JOB_SECRET_KEY'),
    PORT: answers.port && answers.port !== '3000' ? answers.port : undefined,
    BILLING_TIME_SCALE: answers.fastBilling ? '1440' : undefined,
  },
  test: {
    DATABASE_URL: url(DB.test),
    // Mesma senha de demonstração do dev (uma a menos para lembrar).
    SEED_DEFAULT_PASSWORD: answers.demoPassword ?? cur.development.get('SEED_DEFAULT_PASSWORD'),
    CSRF_SECRET: gen('CSRF_SECRET'),
    JOB_SECRET_KEY: gen('JOB_SECRET_KEY'),
  },
  production: production
    ? {
        DATABASE_URL: url(DB.production),
        SEED_ADMIN_EMAIL: answers.adminEmail,
        SEED_ADMIN_PASSWORD: answers.adminPassword,
        CSRF_SECRET: gen('CSRF_SECRET'),
        JOB_SECRET_KEY: gen('JOB_SECRET_KEY'),
      }
    : {},
};
const toAdd = Object.fromEntries(
  Object.entries(plan).map(([env, vars]) => [env, Object.keys(vars).filter((k) => vars[k] !== undefined && !cur[env].has(k))]),
);
const pve = Object.fromEntries(PVE_KEYS.map((k) => [k, cur.development.get(k)]));
const pveTargets = ['test', ...(production || cur.production.size ? ['production'] : [])];
const pveChanges = Object.fromEntries(pveTargets.map((env) => [env, PVE_KEYS.filter((k) => pve[k] && cur[env].get(k) !== pve[k])]));

console.log('\nResumo:');
let nothing = true;
for (const env of Object.keys(plan)) {
  const add = toAdd[env];
  const sync = pveChanges[env] ?? [];
  if (!add.length && !sync.length) continue;
  nothing = false;
  console.log(`  ${files[env]}${cur[env].size ? '' : ' (novo)'}`);
  if (add.length) console.log(`    acrescentar: ${add.join(', ')}`);
  if (sync.length) console.log(`    copiar do .env.development: ${sync.join(', ')}`);
}
if (nothing) console.log('  nada a mudar: os arquivos já têm tudo o que este assistente preenche.');
else if (!(await confirm('\nGravar?', true))) {
  console.log('Nada foi gravado.');
  process.exit(1);
}
prompt?.close();

for (const env of Object.keys(plan)) {
  for (const k of toAdd[env]) setEnv(files[env], k, plan[env][k]);
  for (const k of pveChanges[env] ?? []) setEnv(files[env], k, pve[k]);
}
if (!nothing) console.log('Gravado.');

const missing = PVE_KEYS.filter((k) => !pve[k]);
console.log('\nPróximos passos:');
if (missing.length) {
  console.log('  1. No Git Bash: scripts/pve/bootstrap.sh (cria o token do Proxmox e grava as PVE_* no .env.development)');
  console.log('  2. npm run env:setup de novo (copia as PVE_* para os outros arquivos; não repete as perguntas)');
} else {
  console.log('  npm run db:setup:dev e depois npm run dev (docs/instalacao.md, parte E)');
}
console.log('  A senha dos usuários de demonstração fica em SEED_DEFAULT_PASSWORD, no .env.development.');

// ───────────────────────────── funções ─────────────────────────────

function parseDbUrl(value) {
  const u = new URL(value);
  return { host: `${u.hostname}:${u.port || 3306}`, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

/** Pergunta a senha do MySQL e testa a conexão; repete se o MySQL recusar. */
async function askDbPassword(c) {
  for (let attempt = 1; ; attempt++) {
    const password = auto
      ? argPassword
      : (argPassword ?? (await ask(`MySQL: senha do ${c.user}`, null, (v) => v.length > 0 || 'obrigatória', { secret: true })));
    if (!password) fail('Informe a senha do MySQL (docs/instalacao.md, passo C3): no argumento ou em DB_PASSWORD.');
    const check = await checkMysql({ ...c, password });
    if (check.skipped) {
      console.log('  (teste de conexão pulado: rode npm install antes para testar a senha)');
      return password;
    }
    if (check.ok) {
      console.log('  conexão com o MySQL: ok');
      if (check.missing.length) {
        console.log(`  bancos que não existem ou que o ${c.user} não enxerga: ${check.missing.join(', ')}`);
        console.log('  rode o SQL do passo C3 de docs/instalacao.md como root do MySQL.');
        if (!(await confirm('  Continuar mesmo assim?', false))) fail('Nada foi gravado.');
      }
      return password;
    }
    console.log(`  o MySQL recusou: ${check.error}`);
    if (auto || argPassword || attempt >= 3) fail('Nada foi gravado. Confira o MySQL e a senha (docs/instalacao.md, passo C3).');
  }
}

async function checkMysql({ host, user, password }) {
  let mariadb;
  try {
    mariadb = await import('mariadb');
  } catch {
    return { skipped: true };
  }
  const [hostname, port] = host.split(':');
  let conn;
  try {
    conn = await mariadb.createConnection({
      host: hostname,
      port: Number(port ?? 3306),
      user,
      password,
      connectTimeout: 5000,
      allowPublicKeyRetrieval: true, // MySQL 8.4 (caching_sha2_password) sem TLS, só local (CLAUDE.md, N19)
    });
    const rows = await conn.query('SHOW DATABASES');
    const names = new Set(rows.map((r) => Object.values(r)[0]));
    return { ok: true, missing: Object.values(DB).filter((db) => !names.has(db)) };
  } catch (e) {
    // Usuário inexistente no MySQL 8.4: a autenticação "falsa" cai no plugin mysql_native_password, desligado (erro 1524).
    const hint =
      e.code === 'ER_ACCESS_DENIED_ERROR' || e.errno === 1524
        ? 'usuário ou senha incorretos (ou o usuário não existe)'
        : e.code === 'ECONNREFUSED' || e.code === 'ER_CONNECTION_TIMEOUT'
          ? `nada respondendo em ${host} (o serviço do MySQL está ligado?)`
          : e.message;
    return { ok: false, error: hint };
  } finally {
    await conn?.end().catch(() => {});
  }
}

/** Pergunta com valor padrão e validação. `generated` = Enter gera um valor aleatório. */
async function ask(label, def, validate = () => true, { secret = false, generated } = {}) {
  if (auto) {
    if (generated) return generated();
    if (def === null) fail(`sem resposta para "${label}" no modo --yes`);
    return def;
  }
  for (;;) {
    const answer = await prompt.ask(`${label}${def ? ` [${def}]` : ''}: `, secret);
    if (answer === null) fail('\nCancelado: nada foi gravado.');
    const value = answer === '' ? (generated ? generated() : def) : answer;
    if (value === null || value === '') {
      console.log('  resposta obrigatória');
      continue;
    }
    const ok = validate(value);
    if (ok === true) return value;
    console.log(`  ${ok}`);
  }
}

async function confirm(label, def) {
  if (auto) return def;
  for (;;) {
    const answer = await prompt.ask(`${label} (${def ? 'S/n' : 's/N'}): `, false);
    if (answer === null) fail('\nCancelado: nada foi gravado.');
    if (answer === '') return def;
    if (/^(s|sim|y|yes)$/i.test(answer)) return true;
    if (/^(n|nao|não|no)$/i.test(answer)) return false;
  }
}

function fail(message) {
  console.error(message);
  prompt?.close();
  process.exit(1);
}

/**
 * Leitor de linhas que funciona no terminal (com a senha sem eco) e com a entrada redirecionada (várias respostas de
 * uma vez, ex.: testes). Devolve null se a entrada acabar (Ctrl+C / Ctrl+D).
 */
function createPrompter() {
  const tty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  rl.setPrompt('');
  let muted = false;
  const write = rl._writeToOutput?.bind(rl);
  if (tty && write) rl._writeToOutput = (s) => write(muted ? '' : s);
  const queue = [];
  const waiting = [];
  let closed = false;
  rl.on('SIGINT', () => rl.close()); // Ctrl+C no terminal: cancela sem gravar
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queue.push(line)));
  rl.on('close', () => {
    closed = true;
    while (waiting.length) waiting.shift()(null);
  });
  return {
    ask(question, secret) {
      return new Promise((resolve) => {
        process.stdout.write(question);
        const done = (line) => {
          if (muted) process.stdout.write('\n');
          muted = false;
          resolve(line === null ? null : line.trim());
        };
        if (queue.length) return done(queue.shift());
        if (closed) return done(null);
        muted = secret && tty;
        waiting.push(done);
      });
    },
    close: () => rl.close(),
  };
}
