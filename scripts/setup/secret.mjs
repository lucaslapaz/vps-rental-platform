// Gera um valor válido para uma variável de ambiente secreta (docs/variaveis-de-ambiente.md).
//
//   npm run env:secret                                        # lista as variáveis que dá para gerar
//   npm run env:secret -- CSRF_SECRET                         # imprime CSRF_SECRET=<valor novo>
//   npm run env:secret -- CSRF_SECRET --write development     # grava no .env.development (substitui o valor atual)
//   npm run env:secret -- all --write test                    # gera todas as que se aplicam ao ambiente
//
// O PVE_TOKEN_SECRET não é gerado aqui: é criado pelo próprio Proxmox (scripts/pve/bootstrap.sh --rotate-token).
import { ENVIRONMENTS, envFile, readEnv, SECRETS, setEnv } from './lib.mjs';

const args = process.argv.slice(2);
const writeAt = args.indexOf('--write');
const environment = writeAt >= 0 ? args[writeAt + 1] : undefined;
const name = args.find((a, i) => !a.startsWith('--') && (writeAt < 0 || i !== writeAt + 1));

if (!name) {
  console.log('Variáveis que este utilitário gera (npm run env:secret -- <VARIÁVEL> [--write <ambiente>]):\n');
  for (const [key, s] of Object.entries(SECRETS)) console.log(`  ${key}\n    ${s.what}\n    formato: ${s.format}\n`);
  console.log('  all  todas as acima que se aplicam ao ambiente do --write');
  console.log('\nO PVE_TOKEN_SECRET vem do Proxmox: scripts/pve/bootstrap.sh --rotate-token (Git Bash).');
  process.exit(0);
}
if (name === 'PVE_TOKEN_SECRET') {
  console.error('O PVE_TOKEN_SECRET é criado pelo Proxmox, não localmente. No Git Bash: scripts/pve/bootstrap.sh --rotate-token');
  console.error('e depois npm run env:setup (copia o novo valor para o .env.test e o .env.production).');
  process.exit(2);
}
if (writeAt >= 0 && !ENVIRONMENTS.includes(environment)) {
  console.error(`--write precisa de um ambiente: ${ENVIRONMENTS.join(' | ')}`);
  process.exit(2);
}

// "all": o que existe em cada ambiente (a senha de demonstração não é usada em produção, e o admin de produção só lá).
const forEnvironment = (env) =>
  Object.keys(SECRETS).filter((k) =>
    env === 'production' ? k !== 'SEED_DEFAULT_PASSWORD' : k !== 'SEED_ADMIN_PASSWORD' || readEnv(envFile(env)).has(k),
  );
const keys = name === 'all' ? (environment ? forEnvironment(environment) : Object.keys(SECRETS)) : [name];
const unknown = keys.filter((k) => !SECRETS[k]);
if (unknown.length) {
  console.error(`Variável desconhecida: ${unknown.join(', ')}. Rode npm run env:secret para ver a lista.`);
  process.exit(2);
}

for (const key of keys) {
  const value = SECRETS[key].generate();
  if (!SECRETS[key].validates(value)) throw new Error(`valor gerado inválido para ${key}`); // salvaguarda
  if (!environment) {
    console.log(`${key}=${value}`);
    continue;
  }
  const file = envFile(environment);
  const existed = readEnv(file).has(key);
  setEnv(file, key, value);
  console.log(`${file}: ${key} ${existed ? 'substituída' : 'acrescentada'}`);
  if (existed) console.log(`  atenção: ${SECRETS[key].onChange}`);
}
if (environment) console.log('\nReinicie o servidor (npm run dev / npm start) para ele ler o valor novo.');
