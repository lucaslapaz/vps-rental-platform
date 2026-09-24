import { expect, test } from '@playwright/test';
import { orderAndPay, register, TEXT } from './helpers.ts';

test.use({ locale: 'en-US' });

/**
 * O fluxo principal num segundo idioma (plano §17, Fase 9): o navegador em inglês abre a interface em en-US, e a
 * cobrança continua em BRL. Depois, troca para espanhol pelo menu e a tela muda sem recarregar.
 */
test('cadastro e criação de VPS em inglês; troca para espanhol pelo menu', async ({ page }) => {
  const t = TEXT['en-US'];
  await register(page, 'en-US', 'E2E Customer');
  await expect(
    page
      .getByRole('link', { name: 'My VPS' })
      .or(page.getByRole('link', { name: 'VPS' }))
      .first(),
  ).toBeVisible();

  const hostname = `e2e-en-${Date.now().toString(36)}`;
  await page.goto('/vps/new');
  await expect(page.getByRole('heading', { name: 'Create VPS' })).toBeVisible();
  await expect(page.getByTestId('order-summary')).toContainText('R$'); // o valor cobrado é sempre em BRL
  await orderAndPay(page, 'en-US', hostname);

  const row = page.locator(`[data-hostname="${hostname}"]`);
  await expect(row.getByText(t.running, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'My VPS' })).toBeVisible();

  // Troca de idioma pelo menu: a mesma lista em espanhol.
  await page.getByTestId('language-menu').click();
  await page.getByRole('menuitemradio', { name: 'Español (España)' }).click();
  await expect(page.getByRole('heading', { name: 'Mis VPS' })).toBeVisible();
  await expect(row.getByText('Encendido', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-ES');
});
