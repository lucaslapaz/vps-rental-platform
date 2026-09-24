import { expect, test } from '@playwright/test';
import { orderAndPay, register, TEXT } from './helpers.ts';

/**
 * Fluxo principal em pt-BR (plano §17, Fase 9): cadastro → pedido → pagamento → a VPS fica "Ligada" na lista sem
 * refresh (worker + Socket.IO) → página da VPS → desligar/ligar com confirmação → excluir digitando o hostname.
 */
test('cadastro, criação e ciclo de vida da VPS (pt-BR)', async ({ page }) => {
  const t = TEXT['pt-BR'];
  await register(page, 'pt-BR', 'Cliente E2E');
  await expect(page.getByTestId('dashboard')).toBeVisible();

  const hostname = `e2e-${Date.now().toString(36)}`;
  await orderAndPay(page, 'pt-BR', hostname);
  const row = page.locator(`[data-hostname="${hostname}"]`);
  await expect(row).toBeVisible();
  // Sem recarregar: o evento vps:status do worker atualiza a lista.
  await expect(row.getByText(t.running, { exact: true })).toBeVisible({ timeout: 20_000 });

  await row.getByRole('link', { name: hostname }).click();
  await expect(page.getByTestId('vps-detail')).toHaveAttribute('data-status', 'RUNNING');
  await expect(page.getByTestId('ssh-command')).toContainText(`ssh alpine@`);

  // Desligar (pede confirmação) → Desligada; Ligar → Ligada.
  await page.getByRole('button', { name: 'Desligar' }).click();
  await page.getByTestId('confirm-action').click();
  await expect(page.getByTestId('vps-detail')).toHaveAttribute('data-status', 'STOPPED', { timeout: 20_000 });
  await page.getByTestId('action-start').click();
  await expect(page.getByTestId('vps-detail')).toHaveAttribute('data-status', 'RUNNING', { timeout: 20_000 });

  // Histórico mostra as ações.
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('vps-history')).toContainText('Desligar');

  // Reinstalar (Fase 10): acesso novo por senha, confirmação pelo hostname; a VPS volta a ficar Ligada sem refresh.
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('reinstall-vps').click();
  await expect(page.getByTestId('reinstall-page')).toBeVisible();
  await page.getByTestId('method-password').click();
  await page.locator('#vps-password').fill('Senha-Nova-E2E-1');
  await page.locator('#vps-password2').fill('Senha-Nova-E2E-1');
  await expect(page.getByTestId('reinstall-submit')).toBeDisabled();
  await page.locator('#reinstall-confirm').fill(hostname);
  await page.getByTestId('reinstall-submit').click();
  await expect(page.getByTestId('vps-detail')).toHaveAttribute('data-status', 'RUNNING', { timeout: 20_000 });
  await page.getByTestId('tab-history').click();
  await expect(page.getByTestId('vps-history')).toContainText('Reinstalação');

  // Excluir: o botão só habilita com o hostname digitado.
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('delete-vps').click();
  const confirm = page.getByRole('alertdialog').getByRole('button', { name: 'Excluir VPS' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Hostname', { exact: true }).last().fill(hostname);
  await confirm.click();
  await page.waitForURL(/\/vps$/);
  await expect(page.locator(`[data-hostname="${hostname}"]`)).toHaveCount(0, { timeout: 20_000 });
});
