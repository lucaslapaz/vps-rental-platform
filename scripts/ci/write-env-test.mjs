// CI (GitHub Actions): gera o .env.test com segredos aleatórios e um Proxmox fictício. Os testes do CI usam o provider
// falso (os @lab ficam fora), então o PVE_* só precisa passar na validação do env.ts.
//
//   DATABASE_URL=mysql://vps_app:<senha>@127.0.0.1:3306/vps_platform_test node scripts/ci/write-env-test.mjs
//
// Nunca sobrescreve um .env.test que já existe (o da máquina de desenvolvimento tem as credenciais do laboratório).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const target = '.env.test';
if (existsSync(target)) {
  console.error(`${target} já existe: nada foi alterado.`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url?.startsWith('mysql://') || !url.includes('_test')) {
  console.error('Defina DATABASE_URL apontando para um banco *_test (ex.: mysql://vps_app:senha@127.0.0.1:3306/vps_platform_test).');
  process.exit(1);
}

// Arquivo de CA fictício: o ProxmoxClient só lê o arquivo se for criado, e nos testes do CI ele não é.
mkdirSync('certs', { recursive: true });
writeFileSync('certs/ci-placeholder-ca.pem', '# CA fictícia do CI: os testes usam o provider falso\n');

const secret = (bytes) => randomBytes(bytes).toString('base64url');
const env = {
  DATABASE_URL: url,
  SEED_DEFAULT_PASSWORD: secret(18),
  CSRF_SECRET: secret(48),
  JOB_SECRET_KEY: randomBytes(32).toString('base64'),
  PVE_URL: 'https://pve.invalid:8006',
  PVE_NODE: 'ci',
  PVE_CA_FILE: 'certs/ci-placeholder-ca.pem',
  PVE_TOKEN_ID: 'ci@pve!ci',
  PVE_TOKEN_SECRET: '00000000-0000-0000-0000-000000000000',
};
writeFileSync(
  target,
  `${Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')}\n`,
  { mode: 0o600 },
);
console.log(`${target} gerado para o CI (${Object.keys(env).length} variáveis).`);
