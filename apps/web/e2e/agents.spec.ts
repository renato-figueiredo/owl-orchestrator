import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test('agent library: duplicate → invalid edit is refused with the reason → fix → saved as a file → delete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Agentes', exact: true }).click();
  const library = page.getByRole('region', { name: 'Biblioteca de agentes' });
  for (const nome of ['po', 'tech-lead', 'dev-front', 'dev-back', 'qa', 'revisor', 'memoria', 'roteador', 'refinador-de-prompt']) {
    await expect(library.getByRole('heading', { name: nome, exact: true })).toBeVisible();
  }

  await library.getByRole('button', { name: 'Duplicar revisor' }).click();
  await library.getByLabel('Nome da cópia').fill('revisor-rapido');
  await library.getByRole('button', { name: 'Duplicar', exact: true }).click();
  const card = library.getByRole('heading', { name: 'revisor-rapido', exact: true });
  await expect(card).toBeVisible();

  await library.getByRole('button', { name: 'Editar revisor-rapido' }).click();
  const box = library.getByRole('textbox', { name: /Arquivo do agente revisor-rapido/ });
  const original = await box.inputValue();
  await box.fill(original.replace('provedor: codex-cli', 'provedor: nuvem'));
  await library.getByRole('button', { name: 'Salvar' }).click();
  await expect(library.getByRole('alert')).toContainText('unknown provider "nuvem"');

  await box.fill(original.replace('modelo: sonnet', 'modelo: haiku'));
  await library.getByRole('button', { name: 'Salvar' }).click();
  await expect(box).toHaveCount(0);

  const file = join(process.env.OWL_E2E_DIR!, 'library', 'agents', 'revisor-rapido.md');
  expect(existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('nome: revisor-rapido');

  await library.getByRole('button', { name: 'Excluir revisor-rapido' }).click();
  await library.getByRole('button', { name: 'Confirmar exclusão' }).click();
  await expect(card).toHaveCount(0);
  expect(existsSync(file)).toBe(false);
  await expect(library.getByRole('heading', { name: 'revisor', exact: true })).toBeVisible(); // the example is untouched
});
