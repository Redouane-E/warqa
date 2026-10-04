// What is saved in the browser survives a reload: books (IndexedDB) and keys, and "forget my keys" forgets.
import { expect, test } from '@playwright/test';
import { openStudio } from './helpers';

test('books and keys survive a reload; keys can be forgotten', async ({ page }) => {
  await openStudio(page);
  await expect(page.getByText('No books here yet. Start with a PDF.')).toBeVisible();
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers\/lesson\/ch05/);
  // a change to the lesson is saved too
  const title = page.getByRole('textbox', { name: 'Title' }).first();
  await title.fill('Subtracting, saved in the browser');
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  // a (dummy) key, kept in this browser only
  await page.goto('settings');
  await expect(page.getByText('Your keys are kept only in this browser')).toBeVisible();
  await page.getByLabel('New value for MISTRAL_API_KEY').fill('test-dummy-key-0000wxyz');
  await page.getByRole('button', { name: 'Save keys' }).click();
  await expect(page.locator('.key-row', { hasText: 'MISTRAL_API_KEY' })).toContainText('••••wxyz');

  // the key reaches the model client in the worker (the Mistral provider counts as configured)
  const mistral = () =>
    page.evaluate(async () => {
      const s = (await (await fetch('/warqa/api/status')).json()) as { providers: { id: string; configured: boolean }[] };
      return s.providers.find((p) => p.id === 'mistral')?.configured;
    });
  expect(await mistral()).toBe(true);

  await page.reload();
  await expect(page.locator('.key-row', { hasText: 'MISTRAL_API_KEY' })).toContainText('••••wxyz');
  expect(await mistral()).toBe(true);
  await page.goto('./');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('.book-card')).toContainText('Integers, step by step');
  await page.goto('project/integers/lesson/ch05');
  await expect(page.getByRole('textbox', { name: 'Title' }).first()).toHaveValue('Subtracting, saved in the browser');

  // forget all keys
  await page.goto('settings');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Forget all my keys' }).click();
  await expect(page.locator('.key-row', { hasText: 'MISTRAL_API_KEY' })).toContainText('not set');
  await page.reload();
  await expect(page.locator('.key-row', { hasText: 'MISTRAL_API_KEY' })).toContainText('not set');
  expect(await mistral()).toBe(false);
});

test('a backup imports back as a book', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers/);
  // download the backup, delete the book, import the backup
  const zip = await page.evaluate(async () => {
    const r = await fetch('/warqa/api/web/projects/integers/archive');
    const b = new Uint8Array(await r.arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  });
  await page.goto('project/integers');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete this book from this browser' }).click();
  await expect(page).toHaveURL(/\/warqa\/$/);
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.getByTestId('import-input').setInputFiles({
    name: 'integers.warqa.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip, 'base64'),
  });
  await expect(page).toHaveURL(/\/warqa\/project\/integers$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Integers, step by step');
});

test('one tab at a time: another tab can take the books over', async ({ page, context }) => {
  await openStudio(page);
  const other = await context.newPage();
  await other.goto('./');
  await expect(other.getByText('Warqa is already open in another tab.')).toBeVisible();
  await other.getByRole('button', { name: 'Use Warqa in this tab' }).click();
  await expect(other.getByRole('heading', { name: 'Your books' })).toBeVisible();
  await expect(page.getByText('Warqa is now open in another tab.')).toBeVisible();
});
