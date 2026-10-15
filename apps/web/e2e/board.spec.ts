import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';

test('board: create a ticket, drag it between columns (persists), destructive action → approval → rejection with comment', async ({ page, request }) => {
  const nome = `Quadro E2E ${Date.now()}`;
  const created = await request.post('/api/projects', { data: { nome, pasta: tmpdir() } });
  expect(created.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: `Quadro de ${nome}` }).click();
  const board = page.getByRole('region', { name: `Quadro de ${nome}` });

  await board.getByRole('button', { name: 'Novo ticket' }).click();
  const form = board.getByRole('form', { name: 'Novo ticket' });
  await form.getByRole('textbox', { name: 'Título' }).fill('Cartão arrastável');
  await form.getByRole('button', { name: 'Criar ticket' }).click();
  const panel = board.getByRole('complementary');
  await expect(panel).toContainText('Cartão arrastável');
  await panel.getByRole('button', { name: 'Fechar' }).click();

  // real pointer drag from "Pronto" to "Em revisão"
  const card = board.getByRole('button', { name: /Cartão arrastável/ });
  await expect(board.getByRole('listitem', { name: 'Pronto' }).getByRole('button', { name: /Cartão arrastável/ })).toBeVisible();
  const from = (await card.boundingBox())!;
  const to = (await board.getByRole('listitem', { name: 'Em revisão' }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(board.getByRole('listitem', { name: 'Em revisão' }).getByRole('button', { name: /Cartão arrastável/ })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: `Quadro de ${nome}` }).click();
  await expect(board.getByRole('listitem', { name: 'Em revisão' }).getByRole('button', { name: /Cartão arrastável/ })).toBeVisible();

  // an agent announces a destructive action: the card waits for a person
  const detail = await request.get(`/api/projects/${(await created.json()).project.id}/board`).then((r) => r.json());
  const ticketId = detail.tickets[0].id as string;
  await request.post(`/api/tickets/${ticketId}/status`, { data: { status: 'em_andamento' } });
  const action = await request.post(`/api/tickets/${ticketId}/actions`, { data: { acao: 'rm -rf build/', agente: 'dev-back' } });
  expect(action.status()).toBe(202);

  const queue = board.getByRole('region', { name: 'Fila de aprovações' });
  await expect(queue).toContainText('Ação destrutiva', { timeout: 10_000 });
  await expect(board.getByRole('listitem', { name: 'Aguardando aprovação' }).getByRole('button', { name: /Cartão arrastável/ })).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Rejeitar' })).toBeDisabled(); // a rejection needs a comment
  await queue.getByRole('textbox', { name: 'Comentário da decisão' }).fill('não apague o build');
  await queue.getByRole('button', { name: 'Rejeitar' }).click();

  await expect(board.getByRole('listitem', { name: 'Em andamento' }).getByRole('button', { name: /Cartão arrastável/ })).toBeVisible();
  await expect(queue).toHaveCount(0);
  await board.getByRole('button', { name: /Cartão arrastável/ }).click();
  await expect(board.getByRole('complementary')).toContainText('Rejeitado: não apague o build');
});
