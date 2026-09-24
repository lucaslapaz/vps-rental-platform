import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

// A senha dos usuários de demonstração (técnicos) vem do .env.test, fora do git.
loadDotenv({ path: '.env.test', quiet: true });

export const seedPassword = () => {
  const value = process.env.SEED_DEFAULT_PASSWORD;
  if (!value) throw new Error('SEED_DEFAULT_PASSWORD ausente no .env.test');
  return value;
};

export const uniqueEmail = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}@favo.local`;

/** Textos de tela por idioma, só os que os roteiros usam (as chaves são as mesmas dos arquivos de tradução). */
export const TEXT = {
  'pt-BR': {
    name: 'Nome',
    email: 'E-mail',
    password: 'Senha',
    register: 'Criar conta',
    login: 'Entrar',
    methodPassword: 'Senha',
    userPassword: 'Senha do usuário',
    confirmPassword: 'Confirme a senha',
    holder: 'Nome impresso no cartão',
    running: 'Ligada',
    stopped: 'Desligada',
  },
  'en-US': {
    name: 'Name',
    email: 'Email',
    password: 'Password',
    register: 'Create account',
    login: 'Sign in',
    methodPassword: 'Password',
    userPassword: 'User password',
    confirmPassword: 'Confirm the password',
    holder: 'Name on card',
    running: 'Running',
    stopped: 'Stopped',
  },
} as const;
export type Lang = keyof typeof TEXT;

export async function register(page: Page, lang: Lang, name: string) {
  const t = TEXT[lang];
  const email = uniqueEmail('e2e');
  await page.goto('/register');
  await page.getByLabel(t.name, { exact: true }).fill(name);
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill('senha-forte-e2e-123');
  await page.getByRole('button', { name: t.register }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/register'));
  return email;
}

export async function login(page: Page, email: string, password = seedPassword(), lang: Lang = 'pt-BR') {
  const t = TEXT[lang];
  await page.goto('/login');
  await page.getByLabel(t.email).fill(email);
  await page.getByLabel(t.password, { exact: true }).fill(password);
  await page.getByRole('button', { name: t.login }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** Pedido Alpine Nano com senha, pago com o cartão de teste aprovado. Volta na lista de VPS. */
export async function orderAndPay(page: Page, lang: Lang, hostname: string) {
  const t = TEXT[lang];
  await page.goto('/vps/new');
  await page.getByRole('radio', { name: t.methodPassword, exact: true }).click();
  await page.getByLabel(t.userPassword).fill('senha-da-vps-e2e-1');
  await page.getByLabel(t.confirmPassword).fill('senha-da-vps-e2e-1');
  await page.getByLabel('Hostname').fill(hostname);
  await page.getByTestId('submit-order').click();
  await page.waitForURL(/\/checkout\//);
  await page.getByTestId('test-cards').getByRole('button').first().click();
  await page.getByLabel(t.holder).fill('Cliente E2E');
  await page.getByLabel('CVC').fill('123');
  await page.getByTestId('pay').click();
  await page.waitForURL(/\/vps$/);
}
