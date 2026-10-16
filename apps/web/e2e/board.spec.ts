import { tmpdir } from 'node:os';
import { expect, test, type Locator } from '@playwright/test';

test('board: create a ticket, drag it between columns (persists), destructive action → approval → rejection with comment', async ({ page, request }) => {
  const nome = `Quadro E2E ${Date.now()}`;
  const created = await request.post('/api/projects', { data: { nome, pasta: tmpdir() } });
  expect(created.ok()).toBeTruthy();

  // the project switcher (the Vigia) picks the project; the rail opens its board
  const openBoard = async () => {
    await page.getByRole('button', { name: 'Trocar de projeto' }).click();
    await page.getByRole('option', { name: new RegExp(nome) }).click();
    await page.getByRole('button', { name: 'Quadro', exact: true }).click();
    return page.getByRole('region', { name: `Quadro de ${nome}` });
  };
  const inColumn = (board: Locator, column: string) => board.getByRole('group', { name: column, exact: true }).getByRole('button', { name: /Cartão arrastável/ });

  await page.goto('/');
  const board = await openBoard();

  await board.getByRole('button', { name: 'Novo ticket' }).click();
  const form = board.getByRole('form', { name: 'Novo ticket' });
  await form.getByRole('textbox', { name: 'Título' }).fill('Cartão arrastável');
  await form.getByRole('button', { name: 'Criar ticket' }).click();
  // creating opens the ticket page; go back to the board
  await expect(page.getByRole('region', { name: /^Ticket / })).toContainText('Cartão arrastável');
  await board.getByRole('button', { name: 'Quadro', exact: true }).click();

  // real pointer drag from "Pronto" to "Revisão"
  const card = inColumn(board, 'Pronto');
  await expect(card).toBeVisible();
  const from = (await card.boundingBox())!;
  const to = (await board.getByRole('group', { name: 'Revisão', exact: true }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + Math.min(80, to.height / 2), { steps: 12 });
  await page.mouse.up();
  await expect(inColumn(board, 'Revisão')).toBeVisible();

  await page.reload();
  const reloaded = await openBoard();
  await expect(inColumn(reloaded, 'Revisão')).toBeVisible();

  // an agent announces a destructive action: the card waits for a person
  const detail = await request.get(`/api/projects/${(await created.json()).project.id}/board`).then((r) => r.json());
  const ticketId = detail.tickets[0].id as string;
  await request.post(`/api/tickets/${ticketId}/status`, { data: { status: 'em_andamento' } });
  const action = await request.post(`/api/tickets/${ticketId}/actions`, { data: { acao: 'rm -rf build/', agente: 'dev-back' } });
  expect(action.status()).toBe(202);

  await expect(inColumn(reloaded, 'Aprovar')).toBeVisible({ timeout: 10_000 });

  // the approvals queue (rail) holds it; a rejection needs a reason
  await page.getByRole('button', { name: /^Aprovações/ }).click();
  const queue = page.getByRole('main', { name: 'Aprovações' });
  await queue.getByRole('list', { name: 'Pendentes' }).getByRole('button', { name: /Cartão arrastável/ }).click();
  const selected = queue.getByRole('region', { name: 'Aprovação selecionada' });
  await expect(selected).toContainText('Ação destrutiva');
  await selected.getByRole('button', { name: 'Reprovar com motivo' }).click();
  await expect(selected.getByRole('button', { name: 'Reprovar', exact: true })).toBeDisabled();
  await selected.getByRole('textbox', { name: 'Motivo da reprovação' }).fill('não apague o build');
  await selected.getByRole('button', { name: 'Reprovar', exact: true }).click();
  await expect(selected).toContainText('Você reprovou.');
  await expect(queue.getByRole('list', { name: 'Pendentes' }).getByRole('button', { name: /Cartão arrastável/ })).toHaveCount(0);

  // back on the board the card is with the agent again, and the rejection note is in the ticket
  await page.getByRole('button', { name: 'Quadro', exact: true }).click();
  await expect(inColumn(reloaded, 'Em andamento')).toBeVisible();
  await inColumn(reloaded, 'Em andamento').click();
  await expect(page.getByRole('region', { name: /^Ticket / })).toContainText('Rejeitado: não apague o build');
});
