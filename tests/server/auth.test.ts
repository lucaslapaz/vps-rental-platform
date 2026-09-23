import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { generateSshPublicKey, seedPassword, TestClient, uniqueEmail } from '../helpers/client.ts';

const { app } = createTestApp();
afterAll(closeTestPrisma);

describe('CSRF e origem', () => {
  it('login sem token CSRF → 403 CSRF_INVALID', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'ana@favo.local', password: seedPassword() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('login com Origin de outro site → 403 ORIGIN_INVALID (mesmo com o token certo)', async () => {
    const c = new TestClient(app);
    await c.init();
    const res = await c.send(
      'post',
      '/api/auth/login',
      { email: 'ana@favo.local', password: seedPassword() },
      { Origin: 'http://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORIGIN_INVALID');
  });

  it('Sec-Fetch-Site: cross-site é recusado', async () => {
    const c = new TestClient(app);
    await c.init();
    const res = await c.send(
      'post',
      '/api/auth/login',
      { email: 'ana@favo.local', password: seedPassword() },
      { 'Sec-Fetch-Site': 'cross-site' },
    );
    expect(res.status).toBe(403);
  });

  it('header diferente do cookie → 403 (o token precisa vir nos dois)', async () => {
    const c = new TestClient(app);
    await c.init();
    c.csrfToken = `${c.csrfToken}x`;
    const res = await c.send('post', '/api/auth/login', { email: 'ana@favo.local', password: seedPassword() });
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('o token da pré-sessão deixa de valer depois do login (o binding muda)', async () => {
    const c = new TestClient(app);
    await c.init();
    const preSessionToken = c.csrfToken as string;
    expect((await c.login('ana@favo.local')).status).toBe(200);
    expect(c.csrfToken).not.toBe(preSessionToken);
    const res = await c.send('post', '/api/auth/logout', undefined, { 'X-CSRF-Token': preSessionToken, Cookie: `csrf=${preSessionToken}` });
    expect(res.status).toBe(403);
  });
});

describe('login, me e logout', () => {
  it('GET /api/auth/me sem cookie → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('login correto → cookie HttpOnly/SameSite=Strict e /me com as permissões da role', async () => {
    const c = new TestClient(app);
    const res = await c.login('ANA@favo.local');
    expect(res.status).toBe(200);
    const sid = (res.headers['set-cookie'] as unknown as string[]).find((h) => h.startsWith('sid='));
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Strict/i);
    const me = await c.get('/api/auth/me');
    expect(me.body.user).toMatchObject({ email: 'ana@favo.local', role: 'customer' });
    expect(me.body.user.permissions).toContain('vps:create');
  });

  it('senha errada e e-mail inexistente recebem a MESMA resposta genérica', async () => {
    const wrong = await new TestClient(app).login('ana@favo.local', 'senha-errada-123');
    const unknown = await new TestClient(app).login(uniqueEmail('ninguem'), 'senha-errada-123');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('logout revoga a sessão no banco: o cookie antigo deixa de funcionar', async () => {
    const c = new TestClient(app);
    await c.login('ana@favo.local');
    const oldSid = c.cookies.get('sid') as string;
    expect((await c.send('post', '/api/auth/logout')).status).toBe(204);
    const res = await request(app).get('/api/auth/me').set('Cookie', `sid=${oldSid}`);
    expect(res.status).toBe(401);
  });
});

describe('cadastro', () => {
  it('cria um cliente e já entra logado; e-mail repetido → 409', async () => {
    const email = uniqueEmail('cadastro');
    const c = new TestClient(app);
    await c.init();
    const res = await c.send('post', '/api/auth/register', { name: 'Pessoa Teste', email, password: 'senha-forte-123' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email, role: 'customer' });
    expect((await c.get('/api/auth/me')).status).toBe(200);

    const again = new TestClient(app);
    await again.init();
    const dup = await again.send('post', '/api/auth/register', { name: 'Outra', email, password: 'senha-forte-123' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('dados inválidos → 400 com a chave de tradução de cada campo', async () => {
    const c = new TestClient(app);
    await c.init();
    const res = await c.send('post', '/api/auth/register', { name: 'A', email: 'nao-e-email', password: 'curta' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'name', message: 'nameTooShort' },
        { path: 'email', message: 'email' },
        { path: 'password', message: 'passwordTooShort' },
      ]),
    );
  });
});

describe('RBAC', () => {
  it('técnico de suporte não acessa a administração (403) nem as chaves SSH', async () => {
    const c = new TestClient(app);
    await c.login('carla@favo.local');
    expect((await c.get('/api/admin/users')).status).toBe(403);
    expect((await c.get('/api/account/ssh-keys')).status).toBe(403);
  });

  it('admin lista usuários e roles', async () => {
    const c = new TestClient(app);
    await c.login('admin@favo.local');
    const users = await c.get('/api/admin/users?query=favo.local');
    expect(users.status).toBe(200);
    expect(users.body.users.length).toBeGreaterThan(0);
    const roles = await c.get('/api/admin/roles');
    expect(roles.body.roles.map((r: { key: string }) => r.key)).toEqual(['customer', 'support_agent', 'admin']);
  });

  it('trocar a role revoga as sessões do usuário afetado; o admin não troca a própria role', async () => {
    const email = uniqueEmail('promovido');
    const user = new TestClient(app);
    await user.init();
    const reg = await user.send('post', '/api/auth/register', { name: 'Futuro Técnico', email, password: 'senha-forte-123' });
    const userId = reg.body.user.id as string;

    const admin = new TestClient(app);
    const adminLogin = await admin.login('admin@favo.local');
    const change = await admin.send('patch', `/api/admin/users/${userId}/role`, { role: 'support_agent' });
    expect(change.status).toBe(200);
    expect(change.body).toMatchObject({ changed: true, revokedSessions: 1 });

    expect((await user.get('/api/auth/me')).status).toBe(401); // foi deslogado
    const relogin = new TestClient(app);
    const again = await relogin.login(email, 'senha-forte-123');
    expect(again.body.user.role).toBe('support_agent');
    expect(again.body.user.permissions).toContain('support:queue:read');

    const self = await admin.send('patch', `/api/admin/users/${adminLogin.body.user.id}/role`, { role: 'customer' });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');

    const log = await testPrisma().auditLog.findFirst({ where: { action: 'admin.user_role_changed', targetId: userId } });
    expect(log?.metadata).toMatchObject({ from: 'customer', to: 'support_agent' });
  });
});

describe('minha conta', () => {
  it('trocar a senha revoga as outras sessões, mas mantém a atual', async () => {
    const email = uniqueEmail('senha');
    const a = new TestClient(app);
    await a.init();
    await a.send('post', '/api/auth/register', { name: 'Troca Senha', email, password: 'senha-antiga-123' });
    const b = new TestClient(app);
    await b.login(email, 'senha-antiga-123');

    expect((await a.get('/api/account/sessions')).body.sessions).toHaveLength(2);
    const wrong = await a.send('put', '/api/account/password', { currentPassword: 'errada-errada', newPassword: 'senha-nova-456' });
    expect(wrong.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
    const ok = await a.send('put', '/api/account/password', { currentPassword: 'senha-antiga-123', newPassword: 'senha-nova-456' });
    expect(ok.body).toEqual({ revokedSessions: 1 });

    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await new TestClient(app).login(email, 'senha-nova-456')).status).toBe(200);
  });

  it('chaves SSH: adiciona (com fingerprint), recusa inválida/duplicada e não apaga a de outro usuário', async () => {
    const c = new TestClient(app);
    await c.login('ana@favo.local');
    const publicKey = `${generateSshPublicKey()}\r\n`; // \r\n como vem do Windows
    const added = await c.send('post', '/api/account/ssh-keys', { name: 'notebook', publicKey });
    expect(added.status).toBe(201);
    expect(added.body.key.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);

    expect((await c.send('post', '/api/account/ssh-keys', { name: 'de novo', publicKey })).body.error.code).toBe('SSH_KEY_DUPLICATE');
    const fake = await c.send('post', '/api/account/ssh-keys', {
      name: 'falsa',
      publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAA teste',
    });
    expect(fake.body.error.code).toBe('SSH_KEY_INVALID');

    const other = new TestClient(app);
    await other.login('bruno@favo.local');
    expect((await other.send('delete', `/api/account/ssh-keys/${added.body.key.id}`)).status).toBe(404);
    expect((await c.send('delete', `/api/account/ssh-keys/${added.body.key.id}`)).status).toBe(204);
  });
});
