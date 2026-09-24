import { expect, test } from '@playwright/test';
import { login, register } from './helpers.ts';

/**
 * Aceite da Fase 8 automatizado (plano §17): 2 contextos (cliente + técnico). O técnico está com a fila aberta; o
 * cliente abre a conversa e ela aparece SEM refresh; o técnico assume, os dois trocam mensagens em tempo real e o
 * técnico encerra. Um segundo técnico que tenta assumir a mesma conversa recebe "já assumida".
 */
test('chat de suporte com fila ao vivo entre cliente e técnicos', async ({ browser }) => {
  const customerCtx = await browser.newContext({ locale: 'pt-BR' });
  const carlaCtx = await browser.newContext({ locale: 'pt-BR' });
  const diegoCtx = await browser.newContext({ locale: 'pt-BR' });
  const customer = await customerCtx.newPage();
  const carla = await carlaCtx.newPage();
  const diego = await diegoCtx.newPage();

  await login(carla, 'carla@favo.local');
  await login(diego, 'diego@favo.local');
  await carla.goto('/agent');
  await diego.goto('/agent');
  await expect(carla.getByTestId('agent-page')).toBeVisible();
  await expect(diego.getByTestId('agent-page')).toBeVisible();

  await register(customer, 'pt-BR', 'Cliente Chat E2E');
  await customer.goto('/support');
  const subject = `Ajuda E2E ${Date.now().toString(36)}`;
  await customer.getByLabel('Assunto').fill(subject);
  await customer.getByLabel('Mensagem').fill('Minha VPS não responde.');
  await customer.getByTestId('open-conversation').click();
  await expect(customer.getByTestId('conversation-state')).toContainText('Posição na fila');

  // A conversa aparece na fila dos dois técnicos sem recarregar.
  const carlaItem = carla.locator('[data-testid="queue"] li', { hasText: subject });
  const diegoItem = diego.locator('[data-testid="queue"] li', { hasText: subject });
  await expect(carlaItem).toBeVisible();
  await expect(diegoItem).toBeVisible();

  // Os dois clicam ao mesmo tempo: um assume, o outro vê o aviso.
  await Promise.all([carlaItem.getByTestId('claim').click(), diegoItem.getByTestId('claim').click()]);
  const warning = 'Esta conversa já foi assumida por outro técnico.';
  // Quem perdeu é quem recebe o aviso; espera o aviso aparecer em um dos dois (o chat do vencedor pode demorar a renderizar).
  const carlaLost = await Promise.race([
    carla
      .getByText(warning)
      .waitFor()
      .then(() => true),
    diego
      .getByText(warning)
      .waitFor()
      .then(() => false),
  ]);
  const [winner, winnerName] = carlaLost ? [diego, 'Diego Rocha'] : [carla, 'Carla Mendes'];
  await expect(winner.getByTestId('chat')).toBeVisible();
  await expect(customer.getByTestId('conversation-state')).toHaveText(`Em atendimento com ${winnerName}`);

  // Mensagens nos dois sentidos, em tempo real.
  await customer.getByTestId('chat-input').fill('Ela está ligada, mas não pinga.');
  await customer.getByTestId('chat-input').press('Enter');
  await expect(winner.getByTestId('chat')).toContainText('Ela está ligada, mas não pinga.');
  await winner.getByTestId('chat-input').fill('Vou verificar a rede.');
  await winner.getByTestId('chat-send').click();
  await expect(customer.getByTestId('chat')).toContainText('Vou verificar a rede.');

  // Encerrar: o cliente vê a mensagem do sistema, traduzida.
  await winner.getByRole('button', { name: 'Encerrar' }).click();
  await expect(customer.getByTestId('chat')).toContainText(`Conversa encerrada por ${winnerName}.`);
  await expect(customer.getByTestId('support-page')).toHaveAttribute('data-status', 'CLOSED');

  await Promise.all([customerCtx.close(), carlaCtx.close(), diegoCtx.close()]);
});
