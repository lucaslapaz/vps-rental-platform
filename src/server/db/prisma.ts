import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.ts';

export interface DatabaseOptions {
  url: string;
  poolLimit: number;
}

/**
 * Cria o PrismaClient com o pool do adapter MariaDB (o adapter indicado para MySQL no Prisma 7, plano §8.2).
 * Deve existir UM por processo: o pool é criado no boot e compartilhado, em vez de uma conexão por requisição.
 */
export function createPrismaClient({ url, poolLimit }: DatabaseOptions) {
  const u = new URL(url);
  const adapter = new PrismaMariaDb({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: poolLimit,
    // Com o MySQL fora do ar, a requisição falha em 5 s (o padrão do driver é 10 s). Obs.: nesse caso o
    // $disconnect() fica esperando o pool; o encerramento gracioso tem um timeout que força a saída.
    acquireTimeout: 5000,
    // MySQL 8.4 usa caching_sha2_password. Sem TLS (servidor local), a primeira autenticação precisa da chave
    // pública RSA do servidor; só é seguro porque a conexão é local (127.0.0.1).
    allowPublicKeyRetrieval: u.hostname === '127.0.0.1' || u.hostname === 'localhost',
  });
  return new PrismaClient({ adapter });
}

export type Database = ReturnType<typeof createPrismaClient>;
