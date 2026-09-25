// Funções compartilhadas pelos utilitários de configuração (env.mjs e secret.mjs). Node puro, sem dependências.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const ENVIRONMENTS = ['development', 'test', 'production'];
export const envFile = (environment) => `.env.${environment}`;

/** Variáveis do Proxmox: o scripts/pve/bootstrap.sh grava no .env.development, que é a fonte para os outros arquivos. */
export const PVE_KEYS = ['PVE_URL', 'PVE_NODE', 'PVE_TLS_SERVERNAME', 'PVE_CA_FILE', 'PVE_TOKEN_ID', 'PVE_TOKEN_SECRET'];

const base64url = (bytes) => randomBytes(bytes).toString('base64url');

/**
 * Segredos que dá para gerar localmente. `validates` repete a regra do src/server/config/env.ts ou do prisma/seed/env.ts;
 * `onChange` diz o que acontece ao trocar o valor de um ambiente que já está em uso.
 */
export const SECRETS = {
  CSRF_SECRET: {
    what: 'chave do HMAC que assina o token CSRF (Signed Double-Submit Cookie)',
    format: '64 caracteres aleatórios (48 bytes em base64url); mínimo 32',
    generate: () => base64url(48),
    validates: (v) => v.length >= 32,
    onChange: 'os tokens CSRF emitidos deixam de valer: quem estiver com a página aberta precisa recarregá-la (o login continua)',
  },
  JOB_SECRET_KEY: {
    what: 'chave AES-256-GCM que cifra as senhas das VPS enquanto esperam o pagamento e no payload dos jobs',
    format: 'exatamente 32 bytes aleatórios em base64 (44 caracteres)',
    generate: () => randomBytes(32).toString('base64'),
    validates: (v) => Buffer.from(v, 'base64').length === 32,
    onChange:
      'VPS aguardando pagamento e jobs de criação/reinstalação na fila não conseguem mais ler as senhas e terminam em erro: troque com a fila vazia',
  },
  SEED_DEFAULT_PASSWORD: {
    what: 'senha dos usuários de demonstração (ana@, bruno@, carla@, diego@ e admin@favo.local) em dev e teste',
    format: '16 caracteres aleatórios (12 bytes em base64url); mínimo 10',
    generate: () => base64url(12),
    validates: (v) => v.length >= 10,
    onChange: 'só vale para usuários criados depois: o seed não troca a senha de quem já existe no banco',
  },
  SEED_ADMIN_PASSWORD: {
    what: 'senha do administrador inicial (SEED_ADMIN_EMAIL) criado pelo seed; obrigatória em produção',
    format: '20 caracteres aleatórios (15 bytes em base64url); mínimo 12',
    generate: () => base64url(15),
    validates: (v) => v.length >= 12,
    onChange: 'só vale se o administrador ainda não existir no banco: o seed não troca a senha de quem já existe',
  },
};

/** Lê as linhas KEY=valor de um arquivo .env (ignora comentários e linhas vazias). */
export function readEnv(file) {
  if (!existsSync(file)) return new Map();
  return new Map(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => /^[A-Z0-9_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

/** Grava KEY=valor: substitui a linha existente (no mesmo lugar) ou acrescenta no fim. Preserva comentários e o resto. */
export function setEnv(file, key, value) {
  const text = existsSync(file)
    ? readFileSync(file, 'utf8')
    : `# ${file} (fora do git). Explicação das variáveis: docs/variaveis-de-ambiente.md\n`;
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}
