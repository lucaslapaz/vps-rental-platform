import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/server/db/prisma.ts';
import { closeTestPrisma, createTestApp } from '../helpers/app.ts';

describe('API base', () => {
  const fixedNow = new Date('2026-09-23T12:00:00.000Z');
  const { app } = createTestApp({ clock: { now: () => fixedNow } });
  afterAll(closeTestPrisma);

  it('GET /api/health responde 200 com o estado do app e do banco', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', environment: 'test', time: fixedNow.toISOString(), checks: { database: 'ok' } });
  });

  it('GET /api/health responde 503 quando o banco não responde', async () => {
    // Porta 1: conexão recusada na hora, sem depender de rede.
    const down = createPrismaClient({ url: 'mysql://ninguem:x@127.0.0.1:1/nada', poolLimit: 1 });
    const res = await request(createTestApp({ prisma: down }).app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', checks: { database: 'down' } });
    // Sem await: com o banco inacessível, o $disconnect espera o pool desistir (CLAUDE.md, N19).
    void down.$disconnect();
  }, 10_000);

  it('rota inexistente em /api devolve 404 em JSON, nunca o HTML da SPA', async () => {
    const res = await request(app).get('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('JSON malformado vira 400 sem vazar detalhes internos', async () => {
    const res = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{"quebrado":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: 'Requisição inválida' } });
  });

  it('envia os headers de segurança (CSP estrita fora de desenvolvimento, sem X-Powered-By)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    const csp = Object.fromEntries(
      String(res.headers['content-security-policy'])
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .map(([name, ...values]) => [name, values.join(' ')]),
    );
    expect(csp['script-src']).toBe("'self'");
    expect(csp['frame-ancestors']).toBe("'none'");
  });
});
