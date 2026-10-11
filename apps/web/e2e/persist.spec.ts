// What is saved in the browser survives a reload: books (IndexedDB) and keys, and "forget my keys" forgets.
import { expect, type Page, test } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { confirmDialog, openStudio } from './helpers';

test('books and keys survive a reload; keys can be forgotten', async ({ page }) => {
  await openStudio(page);
  await expect(page.getByRole('heading', { name: 'No books yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers\/lesson\/ch05/);
  // a change to the lesson is saved too
  const title = page.getByRole('textbox', { name: 'Title' }).first();
  await title.fill('Subtracting, saved in the browser');
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await expect(page.locator('.save-state')).toContainText('Saved');

  // a (dummy) key, kept in this browser only (added through the API: checking it would ask Mistral)
  await page.goto('ai');
  await expect(page.getByText('Keys stay on this device')).toBeVisible();
  await page.evaluate(() =>
    fetch('/warqa/api/keys', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ MISTRAL_API_KEY: 'test-dummy-key-0000wxyz' }),
    }),
  );
  await page.reload();
  await expect(page.locator('#key-mistral')).toContainText('•••• wxyz');

  // the key reaches the model client in the worker (the Mistral provider counts as configured)
  const mistral = () =>
    page.evaluate(async () => {
      const s = (await (await fetch('/warqa/api/status')).json()) as { providers: { id: string; configured: boolean }[] };
      return s.providers.find((p) => p.id === 'mistral')?.configured;
    });
  expect(await mistral()).toBe(true);

  await page.reload();
  await expect(page.locator('#key-mistral')).toContainText('•••• wxyz');
  expect(await mistral()).toBe(true);
  await page.goto('./');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('.book-card')).toContainText('Integers, step by step');
  await page.goto('project/integers/lesson/ch05');
  await expect(page.getByRole('textbox', { name: 'Title' }).first()).toHaveValue('Subtracting, saved in the browser');

  // forget all keys
  await page.goto('ai');
  await page.getByRole('button', { name: 'Forget all my keys' }).click();
  await confirmDialog(page, 'Forget all keys');
  await expect(page.locator('#key-mistral')).toContainText('No key yet');
  await page.reload();
  // with no key, Mistral is one of the other services again
  await expect(page.locator('#key-mistral')).toHaveCount(0);
  expect(await mistral()).toBe(false);
});

/** A book's backup, as the page downloads it. It crosses from the page as base64: an array of numbers takes a
 * minute for a few megabytes. */
const download = async (page: Page, id: string) =>
  Buffer.from(
    await page.evaluate(async (b) => {
      const r = await fetch(`/warqa/api/web/projects/${b}/archive`);
      const a = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
      return btoa(s);
    }, id),
    'base64',
  );

test('a backup imports back as a book', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers/);
  // download the backup, delete the book, import the backup
  const zip = await download(page, 'integers');
  await page.goto('project/integers');
  await page.getByRole('button', { name: 'Delete this book from this browser' }).click();
  await confirmDialog(page, 'Delete the book');
  await expect(page).toHaveURL(/\/warqa\/$/);
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.getByTestId('import-input').setInputFiles({
    name: 'integers.warqa.zip',
    mimeType: 'application/zip',
    buffer: zip,
  });
  await expect(page).toHaveURL(/\/warqa\/project\/integers$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Integers, step by step');

  // the same backup again: the book is here already. Esc imports nothing; Keep both adds a second book; Replace
  // puts the backup in the book's place
  const again = async () => {
    await page.goto('./');
    await page.getByTestId('import-input').setInputFiles({
      name: 'integers.warqa.zip',
      mimeType: 'application/zip',
      buffer: zip,
    });
    const dialog = page.getByRole('dialog', { name: 'You already have “Integers, step by step”' });
    await expect(dialog).toBeVisible();
    // the backup says when it was made; the safe choice has the focus
    await expect(dialog).toContainText(/with the changes you made since \w{3} \d{1,2}\./);
    await expect(dialog.getByRole('button', { name: 'Keep both' })).toBeFocused();
    return dialog;
  };
  let dialog = await again();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.book-card')).toHaveCount(1);
  dialog = await again();
  await dialog.getByRole('button', { name: 'Keep both' }).click();
  await expect(page).toHaveURL(/\/warqa\/project\/integers-2$/);
  dialog = await again();
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page).toHaveURL(/\/warqa\/project\/integers$/);
  await expect(page.getByText('The backup replaced “Integers, step by step”.')).toBeVisible();
  await page.goto('./');
  await expect(page.locator('.book-card')).toHaveCount(2);

  // the copy kept beside it has an id of its own, and its backup comes back to it, not to the original
  const copy = unzipSync(new Uint8Array(await download(page, 'integers-2')));
  expect(JSON.parse(strFromU8(copy['integers-2.warqa/warqa.json']!)).id).toBe('integers-2');
  await page.getByTestId('import-input').setInputFiles({
    name: 'integers-2.warqa.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync(copy)),
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(page).toHaveURL(/\/warqa\/project\/integers-2$/);

  // a different book that happens to have the same folder name is never offered for replacement: a copy
  const other = unzipSync(new Uint8Array(zip));
  const book = JSON.parse(strFromU8(other['integers.warqa/warqa.json']!));
  other['integers.warqa/warqa.json'] = strToU8(JSON.stringify({ ...book, title: { en: 'Fractions' } }));
  await page.goto('./');
  await page.getByTestId('import-input').setInputFiles({
    name: 'integers.warqa.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync(other)),
  });
  await expect(page).toHaveURL(/\/warqa\/project\/integers-3$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fractions');
});

test('one tab at a time: another tab can take the books over', async ({ page, context }) => {
  await openStudio(page);
  const other = await context.newPage();
  await other.goto('./');
  await expect(other.getByRole('heading', { name: 'Warqa is open in another tab' })).toBeVisible();
  await expect(other.getByRole('button', { name: 'Use Warqa in this tab' })).toBeFocused();
  await other.getByRole('button', { name: 'Use Warqa in this tab' }).click();
  await expect(other.getByRole('heading', { name: 'Your books' })).toBeVisible();
  await expect(page.getByText('Warqa is now open in another tab.')).toBeVisible();
});

test('storage almost full: a banner with what to do; Your data lists each book with its size', async ({ page }) => {
  // 460 of 500 MB used (92 %): measured in the page
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'estimate', {
      value: async () => ({ usage: 460e6, quota: 500e6 }),
    });
  });
  await openStudio(page);
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers/);
  await page.goto('./');
  const banner = page.locator('.space-banner');
  await expect(banner.getByRole('heading', { name: 'Browser storage almost full' })).toBeVisible();
  await expect(banner.getByRole('img', { name: '92 percent used' })).toBeVisible();
  // (each size is isolated left to right inside the sentence)
  await expect(banner).toContainText(/\u2066460 MB\u2069 of \u2066500 MB\u2069/);
  await expect(banner).toContainText(/There is room for about \u206640 MB\u2069 more\./);
  // the status menu counts it
  await expect(page.locator('.web-status-menu .web-count')).toHaveText(/\d/);

  // what uses space: Your data, each book with its size; deleting one is asked first
  await banner.getByRole('button', { name: 'See what uses space' }).click();
  const sheet = page.getByRole('dialog', { name: 'Your data' });
  const row = sheet.locator('.space-books li', { hasText: 'Integers, step by step' });
  await expect(row).toContainText(/\d+(\.\d+)? (kB|MB)/);
  await row.getByRole('button', { name: 'Delete: Integers, step by step' }).click();
  await confirmDialog(page, 'Delete the book');
  await expect(page.getByText('“Integers, step by step” was deleted from this browser.')).toBeVisible();
  await expect(sheet.locator('.space-books li')).toHaveCount(0);
  // Your books behind the sheet follows
  await expect(page.locator('.book-card')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).first().click();

  // closed: gone for the session
  await banner.getByRole('button', { name: 'Close' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.space-banner')).toHaveCount(0);
});
