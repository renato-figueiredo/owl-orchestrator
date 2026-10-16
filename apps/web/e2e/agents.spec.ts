import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('agent library: duplicate → invalid edit is refused with the reason → fix → saved as a file → delete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  const library = page.getByRole('main', { name: 'Biblioteca de agentes' });
  const editor = library.getByRole('complementary', { name: 'Editor de agente' });
  const cardOf = (nome: string) => library.getByRole('button', { name: `Editar ${nome}`, exact: true });
  for (const nome of ['po', 'tech-lead', 'dev-front', 'dev-back', 'qa', 'revisor', 'memoria', 'roteador', 'refinador-de-prompt']) {
    await expect(cardOf(nome)).toBeVisible();
  }

  // the editor shows one agent at a time: pick "revisor", then duplicate it (the copy opens in the editor)
  await cardOf('revisor').click();
  await expect(editor.getByRole('heading', { name: 'revisor', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Duplicar revisor' }).click();
  await editor.getByLabel('Nome da cópia').fill('revisor-rapido');
  await editor.getByRole('button', { name: 'Criar cópia' }).click();
  const card = cardOf('revisor-rapido');
  await expect(card).toBeVisible();

  const box = editor.getByRole('textbox', { name: /Arquivo do agente revisor-rapido/ });
  await expect(box).toBeVisible(); // the copy is already open in the editor after duplicating
  const original = await box.inputValue();
  await box.fill(original.replace('provedor: codex-cli', 'provedor: nuvem'));
  await editor.getByRole('button', { name: 'Salvar' }).click();
  await expect(editor.getByRole('alert')).toContainText('unknown provider "nuvem"');

  await box.fill(original.replace('modelo: sonnet', 'modelo: haiku'));
  await editor.getByRole('button', { name: 'Salvar' }).click();
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await expect(box).toHaveValue(/modelo: haiku/); // reloaded from the saved file

  const file = join(process.env.OWL_E2E_DIR!, 'library', 'agents', 'revisor-rapido.md');
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('nome: revisor-rapido');

  await editor.getByRole('button', { name: 'Excluir revisor-rapido' }).click();
  await editor.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await expect(card).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
  await expect(cardOf('revisor')).toBeVisible(); // the example is untouched
});
