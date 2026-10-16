import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('answer streams in, persists after reload, and the session is reachable by keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().click();

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
  await expect(page.getByRole('button', { name: 'diga olá', exact: true })).toBeVisible();
  await expect(page.getByLabel('Histórico de execuções')).toContainText('ent ·'); // usage stays visible

  await page.reload();
  await page.getByRole('button', { name: 'diga olá', exact: true }).click();
  await expect(log.getByText('diga olá')).toBeVisible();
  await expect(log.getByText(replyText)).toBeVisible();

  // Keyboard: focus the session list, move with the arrows, activate with Enter.
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().click();
  await page.getByRole('button', { name: 'diga olá', exact: true }).focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Mensagem')).toBeEnabled();
});

test('cancel stops a running run and the page shows it as cancelled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().click();
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
  await page.getByRole('button', { name: 'Projetos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo projeto' }).first().click();
  const modal = page.getByRole('dialog', { name: 'Novo projeto' });
  const next = modal.getByRole('button', { name: /^(Continuar|Criar projeto)/ });
  await modal.getByLabel('Caminho da pasta').fill('/etc');
  await next.click();
  await modal.getByLabel('Nome', { exact: true }).fill('Alfa');
  await next.click();
  await expect(modal.getByRole('alert')).toContainText('outside the allowed workspace roots');

  await modal.getByRole('button', { name: 'Voltar' }).click();
  await modal.getByLabel('Caminho da pasta').fill(mkdtempSync(join(tmpdir(), 'owl-e2e-proj-')));
  await next.click();
  await next.click();
  await modal.getByRole('button', { name: 'Abrir projeto' }).click();
  const conversas = page.getByRole('complementary', { name: 'Conversas' });
  await expect(conversas.getByRole('heading', { name: 'Alfa' })).toBeVisible();

  await conversas.getByRole('button', { name: 'Nova conversa', exact: true }).first().click(); // the first is the header button; a fading item of the previous list may share the name
  await page.getByLabel('Mensagem').fill('dentro do projeto');
  await page.getByLabel('Mensagem').press('Enter');
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });
  await expect(conversas.getByRole('button', { name: 'dentro do projeto', exact: true })).toBeVisible();
});

test('melhorar prompt: the refined prompt can be edited and the edit is what runs; both steps show in the panel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().click();
  await page.getByRole('button', { name: 'Refinar prompt' }).click();
  await page.getByRole('switch', { name: 'Editar antes de executar' }).click();
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
  await page.getByRole('button', { name: 'conserte o login', exact: true }).click();
  await expect(page.getByText('Prompt melhorado usado nesta execução')).toBeVisible();
  await expect(page.getByLabel('Histórico de execuções').getByText('executar', { exact: true })).toBeVisible();
});

test('melhorar prompt without review chains both steps by itself', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().click();
  await page.getByRole('button', { name: 'Refinar prompt' }).click();
  await page.getByLabel('Refinador').selectOption({ label: 'haiku' });
  await page.getByLabel('Mensagem').fill('liste os arquivos');
  await page.getByLabel('Mensagem').press('Enter');
  await expect(page.getByLabel('Histórico de execuções').getByText('executar', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });
  const steps = page.getByLabel('Histórico de execuções').getByRole('listitem');
  await expect(steps.filter({ hasText: 'melhorar' })).toContainText('concluído');
  await expect(steps.filter({ hasText: 'executar' })).toContainText('concluído');
});

test('switching provider: warns, summarizes first, hands the summary over, and the memory tab shows it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().click();
  await page.getByLabel('Mensagem').fill('primeira conversa sobre o login');
  await page.getByLabel('Mensagem').press('Enter');
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });

  // choose who writes the summaries (the plain fake CLIs would answer "ok", which is not valid JSON)
  await page.getByRole('tab', { name: 'Memória' }).click();
  await page.getByText('Configurações da memória').click();
  await page.getByLabel('Resumidor', { exact: true }).selectOption('ollama');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Memória' }).getByRole('status')).toContainText('Configurações salvas.');

  await page.getByLabel('Provedor').selectOption('codex-cli');
  await page.getByLabel('Mensagem').fill('agora continue no outro provedor');
  await page.getByLabel('Mensagem').press('Enter');
  const notice = page.getByRole('alertdialog', { name: 'Troca de provedor' });
  await expect(notice).toContainText('não acompanha');
  await notice.getByRole('button', { name: 'Resumir e trocar' }).click();

  await expect(notice).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });

  // the summary and the facts the summarizer proposed are on the memory tab
  await expect(page.getByLabel('Resumo (editável)')).toHaveValue(/Resumo novo da conversa\./);
  await expect(page.getByText('Usar pnpm no projeto')).toBeVisible();
  // pin one: pinned facts are what gets sent from now on
  await page.getByRole('button', { name: 'Fixar: Usar pnpm no projeto' }).click();
  await expect(page.getByRole('button', { name: 'Fixar: Usar pnpm no projeto' })).toHaveAttribute('aria-pressed', 'true');

  // the summary run is listed (usage is transparent) next to both chat runs
  await page.getByRole('tab', { name: 'Execução' }).click();
  const history = page.getByLabel('Histórico de execuções');
  await expect(history.getByText('resumo', { exact: true })).toBeVisible();
  await expect(history.getByText('codex-cli')).toBeVisible();
});
