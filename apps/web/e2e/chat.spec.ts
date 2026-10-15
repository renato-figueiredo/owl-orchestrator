import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('answer streams in, persists after reload, and the session is reachable by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa' }).click();

  const box = page.getByLabel('Mensagem');
  await box.fill('diga olá');
  await box.press('Enter');

  // The fake CLI replays a real captured answer; the log region must show it and the run must finish.
  const log = page.getByRole('log');
  await expect(log.getByText('diga olá')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });
  const reply = log.locator('p').last();
  await expect(reply).not.toHaveText('');
  const replyText = (await reply.textContent())!;

  // The session title comes from the first message.
  await expect(page.getByRole('button', { name: 'diga olá' })).toBeVisible();
  await expect(page.getByTestId('session-total')).toContainText('ent');

  await page.reload();
  await page.getByRole('button', { name: 'diga olá' }).click();
  await expect(log.getByText('diga olá')).toBeVisible();
  await expect(log.getByText(replyText)).toBeVisible();

  // Keyboard: focus the session list, move with the arrows, activate with Enter.
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await page.getByRole('button', { name: 'diga olá' }).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Mensagem')).toBeEnabled();
});

test('cancel stops a running run and the page shows it as cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await page.getByLabel('Provedor').selectOption('fake-hang');
  await page.getByLabel('Mensagem').fill('algo demorado');
  await page.getByLabel('Mensagem').press('Enter');

  const cancel = page.getByRole('button', { name: 'Cancelar' });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByText('Execução cancelada.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible();
  await expect(page.getByLabel('Histórico de execuções').getByText('cancelado')).toBeVisible();
});

test('a project keeps its conversations apart and refuses folders outside the workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Projeto +' }).click();
  await page.getByLabel('Nome').fill('Alfa');
  await page.getByLabel('Pasta do projeto').fill('/etc');
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await expect(page.getByRole('alert')).toContainText('outside the allowed workspace roots');

  await page.getByLabel('Pasta do projeto').fill(mkdtempSync(join(tmpdir(), 'owl-e2e-proj-')));
  await page.getByRole('button', { name: 'Criar projeto' }).click();
  await expect(page.getByRole('heading', { name: 'Alfa' })).toBeVisible();

  await page.getByRole('button', { name: 'Nova conversa em Alfa' }).click();
  await page.getByLabel('Mensagem').fill('dentro do projeto');
  await page.getByLabel('Mensagem').press('Enter');
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });
  const nav = page.getByRole('navigation', { name: 'Projetos e conversas' });
  await expect(nav.getByRole('button', { name: 'dentro do projeto' })).toBeVisible();
});

test('melhorar prompt: the refined prompt can be edited and the edit is what runs; both steps show in the panel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await page.getByLabel('Melhorar prompt').check();
  await page.getByLabel('Editar antes de executar').check();
  await page.getByLabel('Mensagem').fill('conserte o login');
  await page.getByLabel('Mensagem').press('Enter');

  const editor = page.getByLabel('Prompt melhorado (editável)');
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor).not.toHaveValue('');
  await editor.fill('PROMPT EDITADO: conserte o login sem mexer no banco');
  await page.getByRole('button', { name: 'Executar com a minha edição' }).click();

  // second step runs; the refined prompt collapses into the history
  await expect(page.getByText('Prompt melhorado usado nesta execução')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });
  const history = page.getByLabel('Histórico de execuções');
  await expect(history.getByText('melhorar', { exact: true })).toBeVisible();
  await expect(history.getByText('executar', { exact: true })).toBeVisible();

  // persists after a reload, with both steps
  await page.reload();
  await page.getByRole('button', { name: 'conserte o login' }).click();
  await expect(page.getByText('Prompt melhorado usado nesta execução')).toBeVisible();
  await expect(page.getByLabel('Histórico de execuções').getByText('executar', { exact: true })).toBeVisible();
});

test('melhorar prompt without review chains both steps by itself', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa' }).click();
  await page.getByLabel('Melhorar prompt').check();
  await page.getByLabel('Refinador').selectOption({ label: 'haiku' });
  await page.getByLabel('Mensagem').fill('liste os arquivos');
  await page.getByLabel('Mensagem').press('Enter');
  await expect(page.getByLabel('Histórico de execuções').getByText('executar', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Histórico de execuções').getByText('ok', { exact: true })).toHaveCount(2);
});
