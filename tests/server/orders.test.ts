import { afterAll, describe, expect, it } from 'vitest';
import { TOKENS } from '../../src/server/container/tokens.ts';
import type { SecretBox } from '../../src/server/utils/secretBox.ts';
import { closeTestPrisma, createTestApp, testPrisma } from '../helpers/app.ts';
import { generateSshPublicKey, TestClient, uniqueEmail } from '../helpers/client.ts';

// Capacidade folgada nos testes (os tetos reais do laboratório são testados à parte, com valores baixos).
const { app, di, virtualization } = createTestApp({ env: { CAPACITY_MAX_MEMORY_MB: 1_000_000, CAPACITY_MAX_DISK_GB: 100_000 } });
const db = testPrisma();
// Muitos pedidos ficam aguardando pagamento nesta suíte e todos reservam memória do nó: um nó falso grande evita
// que a folga dependa da ordem dos testes (o teste de capacidade troca o nó de propósito).
virtualization.memAvailableMb = 64 * 1024;
const createdUsers: string[] = [];

afterAll(async () => {
  // Limpa o que estes testes criaram (o banco de teste não é recriado a cada execução).
  const vps = await db.vps.findMany({ where: { userId: { in: createdUsers } }, select: { id: true } });
  const vpsIds = vps.map((v) => v.id);
  await db.job.deleteMany({ where: { type: 'provision_vps' } });
  await db.payment.deleteMany({ where: { invoice: { userId: { in: createdUsers } } } });
  await db.invoice.deleteMany({ where: { userId: { in: createdUsers } } });
  await db.vpsEvent.deleteMany({ where: { vpsId: { in: vpsIds } } });
  await db.vps.deleteMany({ where: { id: { in: vpsIds } } });
  await closeTestPrisma();
});

async function customer() {
  const c = new TestClient(app);
  await c.init();
  const res = await c.send('post', '/api/auth/register', {
    name: 'Cliente Pedido',
    email: uniqueEmail('pedido'),
    password: 'senha-forte-123',
  });
  createdUsers.push(res.body.user.id);
  return c;
}

const order = (over: Record<string, unknown> = {}) => ({
  osTemplate: 'alpine-3.24',
  plan: 'nano',
  hostname: 'minha-vps',
  username: 'lucas',
  password: 'senha-da-vps-123',
  sshPasswordAuth: true,
  ...over,
});

const card = (number: string) => ({
  cardNumber: number,
  holder: 'Cliente Teste',
  expMonth: 12,
  expYear: new Date().getFullYear() + 2,
  cvc: '123',
});

describe('catálogo', () => {
  it('lista planos e imagens com os mínimos (público)', async () => {
    const c = new TestClient(app);
    const plans = await c.get('/api/plans');
    expect(plans.body.plans.map((p: { slug: string }) => p.slug)).toEqual(['nano', 'micro', 'small', 'medium']);
    const imgs = await c.get('/api/os-templates');
    const desktop = imgs.body.osTemplates.find((t: { slug: string }) => t.slug === 'alpine-3.24-desktop');
    expect(desktop).toMatchObject({ requiresPassword: true, hasGui: true, minMemoryMb: 1024 });
  });
});

describe('pedido (POST /api/vps)', () => {
  it('Debian no plano Nano → 422 PLAN_BELOW_IMAGE_MINIMUM (mesmo burlando o frontend)', async () => {
    const c = await customer();
    const res = await c.send('post', '/api/vps', order({ osTemplate: 'debian-13', plan: 'nano' }));
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'PLAN_BELOW_IMAGE_MINIMUM', details: { minMemoryMb: 512, minDiskGb: 3 } });
  });

  it('Desktop sem senha → 422 PASSWORD_REQUIRED; sem nenhum método de acesso → 400', async () => {
    const c = await customer();
    const noPass = await c.send(
      'post',
      '/api/vps',
      order({
        osTemplate: 'alpine-3.24-desktop',
        plan: 'medium',
        password: undefined,
        sshPasswordAuth: false,
        newSshKey: { publicKey: generateSshPublicKey() },
      }),
    );
    expect(noPass.body.error.code).toBe('PASSWORD_REQUIRED');
    const noAuth = await c.send('post', '/api/vps', order({ password: undefined, sshPasswordAuth: false }));
    expect(noAuth.status).toBe(400);
    expect(noAuth.body.error.details).toContainEqual({ path: 'password', message: 'authMethodRequired' });
  });

  it('usuário reservado, hostname inválido e chave de outro cliente são recusados', async () => {
    const c = await customer();
    const bad = await c.send('post', '/api/vps', order({ username: 'root', hostname: 'Nome Com Espaço' }));
    expect(bad.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'username', message: 'usernameReserved' },
        { path: 'hostname', message: 'hostname' },
      ]),
    );
    const other = await c.send('post', '/api/vps', order({ sshKeyIds: [999_999] }));
    expect(other.body.error.code).toBe('SSH_KEY_NOT_FOUND');
  });

  it('cria a VPS aguardando pagamento + fatura; as senhas ficam CIFRADAS no banco', async () => {
    const c = await customer();
    const key = generateSshPublicKey('notebook');
    const res = await c.send(
      'post',
      '/api/vps',
      order({ newSshKey: { publicKey: key, name: 'notebook', save: true }, rootPassword: 'senha-root-12345' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.vps).toMatchObject({ status: 'PENDING_PAYMENT', hostname: 'minha-vps', rootPasswordSet: true });
    expect(res.body.invoice).toMatchObject({ status: 'PENDING', amountCents: 990, currency: 'BRL' });
    expect(res.body.vps.pendingInvoice).toMatchObject({ id: res.body.invoice.id, kind: 'CREATION' });

    const row = await db.vps.findUniqueOrThrow({ where: { id: res.body.vps.id } });
    expect(row.provisionSecrets).toMatch(/^v1\./);
    expect(row.provisionSecrets).not.toContain('senha-da-vps-123');
    const secrets = JSON.parse(di.resolve<SecretBox>(TOKENS.SecretBox).open(row.provisionSecrets as string));
    expect(secrets).toMatchObject({ password: 'senha-da-vps-123', rootPassword: 'senha-root-12345' });
    expect(secrets.sshKeys[0]).toMatch(/^ssh-ed25519 \S+ notebook$/);
    expect((await c.get('/api/account/ssh-keys')).body.keys).toHaveLength(1); // "salvar na conta"
  });

  it('limite de VPS por cliente → 409 VPS_LIMIT_REACHED', async () => {
    const c = await customer();
    expect((await c.send('post', '/api/vps', order({ hostname: 'a1' }))).status).toBe(201);
    expect((await c.send('post', '/api/vps', order({ hostname: 'a2' }))).status).toBe(201);
    const third = await c.send('post', '/api/vps', order({ hostname: 'a3' }));
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('VPS_LIMIT_REACHED');
  });

  it('sem estoque (teto configurado ou nó cheio) → 409 NO_CAPACITY; Proxmox fora → 503', async () => {
    const tight = createTestApp({ env: { CAPACITY_MAX_MEMORY_MB: 1 } });
    const c = new TestClient(tight.app);
    await c.init();
    const reg = await c.send('post', '/api/auth/register', {
      name: 'Sem Estoque',
      email: uniqueEmail('pedido'),
      password: 'senha-forte-123',
    });
    createdUsers.push(reg.body.user.id);
    expect((await c.send('post', '/api/vps', order())).body.error.code).toBe('NO_CAPACITY');

    virtualization.capacity = async () => {
      throw new Error('fora do ar');
    };
    const c2 = await customer();
    const down = await c2.send('post', '/api/vps', order());
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('PROXMOX_UNAVAILABLE');
    Reflect.deleteProperty(virtualization, 'capacity'); // volta ao método da classe
  });

  it('a capacidade do nó usa a memória DISPONÍVEL (inclui o cache), não só a livre (CLAUDE.md C25)', async () => {
    const base = await virtualization.capacity();
    const MB = 1024 * 1024;
    // 300 MB "livres", mas 1,4 GB disponíveis (o resto é cache de disco): o Nano (256 MB) cabe.
    virtualization.capacity = async () => ({ ...base, memFreeBytes: 300 * MB, memAvailableBytes: 1400 * MB });
    const c = await customer();
    const fits = await c.send('post', '/api/vps', order({ hostname: 'cabe-no-cache' }));
    expect(fits.status).toBe(201);
    // Cancela o pedido: VPS aguardando pagamento também reservam memória do nó (os outros testes precisam da folga).
    expect((await c.send('delete', `/api/vps/${fits.body.vps.id}`)).status).toBe(202);
    // Só 100 MB disponíveis: não cabe.
    virtualization.capacity = async () => ({ ...base, memFreeBytes: 100 * MB, memAvailableBytes: 100 * MB });
    const c2 = await customer();
    expect((await c2.send('post', '/api/vps', order({ hostname: 'nao-cabe' }))).body.error.code).toBe('NO_CAPACITY');
    Reflect.deleteProperty(virtualization, 'capacity');
  });

  it('técnico de suporte não cria nem lista VPS (403)', async () => {
    const t = new TestClient(app);
    await t.login('carla@favo.local');
    expect((await t.get('/api/vps')).status).toBe(403);
    expect((await t.send('post', '/api/vps', order())).status).toBe(403);
  });
});

describe('pagamento simulado', () => {
  it('cartão …0002 recusa (402) e deixa tentar de novo; …4242 aprova e gera o job provision_vps', async () => {
    const c = await customer();
    const { body } = await c.send('post', '/api/vps', order());
    const invoiceId = body.invoice.id as string;

    const declined = await c.send('post', `/api/invoices/${invoiceId}/pay`, card('4000 0000 0000 0002'));
    expect(declined.status).toBe(402);
    expect(declined.body.error).toMatchObject({ code: 'PAYMENT_DECLINED', details: { failureCode: 'card_declined' } });
    expect((await c.get(`/api/invoices/${invoiceId}`)).body.invoice.status).toBe('PENDING');

    const paid = await c.send('post', `/api/invoices/${invoiceId}/pay`, card('4242 4242 4242 4242'));
    expect(paid.status).toBe(200);
    expect(paid.body.invoice).toMatchObject({ status: 'PAID', vps: { status: 'PROVISIONING' } });
    expect(paid.body.invoice.payments.map((p: { status: string }) => p.status)).toEqual(['APPROVED', 'DECLINED']);
    expect(paid.body.invoice.payments[0]).toMatchObject({ cardBrand: 'visa', cardLast4: '4242' });

    const vps = await db.vps.findUniqueOrThrow({ where: { id: body.vps.id } });
    expect(vps.provisionSecrets).toBeNull(); // saiu da VPS e foi para o job
    const job = await db.job.findFirstOrThrow({ where: { type: 'provision_vps', payload: { path: '$.vpsId', equals: body.vps.id } } });
    expect(job.status).toBe('QUEUED');
    expect(String((job.payload as { secrets: string }).secrets)).toMatch(/^v1\./);

    const again = await c.send('post', `/api/invoices/${invoiceId}/pay`, card('4242 4242 4242 4242'));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVOICE_NOT_PAYABLE');
  });

  it('dois pagamentos simultâneos da mesma fatura: exatamente um aprova, o outro recebe 409', async () => {
    const c = await customer();
    const { body } = await c.send('post', '/api/vps', order());
    const pay = () => c.send('post', `/api/invoices/${body.invoice.id}/pay`, card('4242424242424242'));
    const results = await Promise.all([pay(), pay(), pay()]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await db.payment.count({ where: { invoiceId: body.invoice.id } })).toBe(1);
    expect(await db.job.count({ where: { type: 'provision_vps', payload: { path: '$.vpsId', equals: body.vps.id } } })).toBe(1);
  });

  it('cartão inválido (Luhn/validade) → 400; fatura de outro cliente → 404; nada de PAN no banco', async () => {
    const c = await customer();
    const { body } = await c.send('post', '/api/vps', order());
    const invalid = await c.send('post', `/api/invoices/${body.invoice.id}/pay`, { ...card('4242 4242 4242 4241'), expYear: 2020 });
    expect(invalid.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'cardNumber', message: 'cardNumber' },
        { path: 'expMonth', message: 'cardExpired' },
      ]),
    );
    const other = await customer();
    expect((await other.send('post', `/api/invoices/${body.invoice.id}/pay`, card('4242424242424242'))).status).toBe(404);
    const stored = await db.payment.findMany({ where: { cardLast4: '4242' }, take: 5 });
    for (const p of stored) expect(JSON.stringify(p)).not.toMatch(/4242424242424242|"cvc"/);
  });
});
