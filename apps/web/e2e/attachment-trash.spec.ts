import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// 8x8 PNG; the server re-encodes it to WebP and stores it by content hash.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4YWODFTEMLQkAZZlQAVIPr1MAAAAASUVORK5CYII=',
  'base64',
);

/** WebP blobs currently stored (the folder is created on the first upload). */
const storedBlobs = (): string[] => {
  const root = join(process.env.OWL_E2E_DIR!, 'attachments');
  try {
    return readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.webp'));
  } catch {
    return [];
  }
};

test('improve prompt + screenshot → stream → trash → delete for good → files are gone', async ({ page }) => {
  expect(storedBlobs()).toHaveLength(0);

  await page.goto('/');
  await page.getByRole('button', { name: 'Nova conversa', exact: true }).first().click();
  await page.getByLabel('Melhorar prompt').check();
  await page.getByLabel('Refinador').selectOption({ label: 'haiku' });

  // attach a screenshot through the real file input
  await page.getByLabel('Escolher imagens').setInputFiles({ name: 'print-erro.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByLabel('Imagens anexadas').getByRole('img', { name: 'print-erro.png' })).toBeVisible();
  await expect(page.getByText('Enviando…')).toHaveCount(0);

  await page.getByLabel('Mensagem').fill('o botão de salvar some neste print');
  await page.getByLabel('Mensagem').press('Enter');

  // both steps run and stream; the answer is stored
  const history = page.getByLabel('Histórico de execuções');
  await expect(history.getByText('executar', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible({ timeout: 15_000 });
  await expect(history.getByText('ok', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('log').getByRole('button', { name: 'Ampliar print-erro.png' })).toBeVisible();
  expect(storedBlobs()).toHaveLength(1);

  // moving to the trash hides the conversation but keeps the file (it can be restored)
  const title = 'o botão de salvar some neste print';
  await page.getByRole('button', { name: `Mover para a lixeira: ${title}` }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
  expect(storedBlobs()).toHaveLength(1);

  // deleting for good asks for confirmation, then removes the row and the file
  await page.locator('summary', { hasText: 'Lixeira' }).click();
  await page.getByRole('button', { name: 'Excluir de vez' }).click();
  await page.getByRole('button', { name: 'Confirmar: excluir para sempre' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Conversa excluída' })).toBeVisible();
  await expect(page.getByText('A lixeira está vazia.')).toBeVisible();
  expect(storedBlobs()).toHaveLength(0);

  // and it does not come back after a reload
  await page.reload();
  await expect(page.getByRole('button', { name: title, exact: true })).toHaveCount(0);
});
