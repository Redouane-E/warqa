// Reviewing translations in the browser, on the example book: filter, approve, correct, approve what is shown,
// download the spreadsheet and import a reviewed one; the review survives a reload. Also in Arabic.
import { expect, test } from '@playwright/test';
import { openStudio } from './helpers';

const rows = (page: import('@playwright/test').Page) => page.locator('.review-row');

test('review the French translation of the example book', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/lesson\/ch05/);
  await page.goto('project/integers?step=voice');
  await page.getByRole('link', { name: 'Review translations' }).click();
  await expect(page).toHaveURL(/\/warqa\/project\/integers\/review/);
  await expect(page.getByRole('heading', { level: 1, name: 'Review translations' })).toBeVisible();
  await expect(page.getByText('never overwrites it')).toBeVisible();

  await page.getByRole('button', { name: 'French' }).click();
  await expect(rows(page).first()).toBeVisible();
  const total = await rows(page).count();
  expect(total).toBeGreaterThan(20);

  // approve one string, correct another
  const first = rows(page).first();
  await first.getByRole('button', { name: 'Approve' }).click();
  await expect(first.locator('.review-state')).toHaveText('approved');
  const second = rows(page).nth(1);
  const box = second.locator('textarea');
  const before = await box.inputValue();
  await box.fill(`${before} (relu)`);
  await second.getByRole('button', { name: 'Save my wording' }).click();
  await expect(second.locator('.review-state')).toHaveText('edited');

  // the "checked by a person" filter shows them
  await page.getByRole('button', { name: /^Checked by a person/ }).click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole('button', { name: /^All/ }).click();

  // approve what is shown (after reading it)
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /^Approve the \d+ strings shown/ }).click();
  await expect(page.getByText(/strings approved/)).toBeVisible();
  // a page shows 100 strings: the rest are approved from the "made by the model" list
  await page.getByRole('button', { name: /^Made by the model/ }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /^Approve the \d+ strings? shown|^Approve the string shown/ }).click();
  await expect(rows(page)).toHaveCount(0);

  // a reload keeps the review (it is saved in the browser)
  await page.reload();
  await page.getByRole('button', { name: /^Checked by a person/ }).click();
  await expect.poll(() => rows(page).count()).toBeGreaterThan(20);
  await expect(page.locator('textarea').filter({ hasText: '(relu)' })).toHaveCount(1);

  // the spreadsheet: download, change a translation, import it back
  const href = await page.getByRole('link', { name: 'Download spreadsheet (CSV)' }).getAttribute('href');
  expect(href).toBe('/warqa/api/projects/integers/review/fr.csv');
  const csv = await page.evaluate(async (u) => (await fetch(u!)).text(), href);
  const lines = csv.split('\r\n');
  expect(lines[0]).toContain('lesson,key,where,state,problems,source,translation,ok');
  expect(lines.some((l) => l.startsWith('ch05,beat.intro.title,'))).toBe(true);
  // a reviewer's sheet only needs the lesson, key, translation and ok columns
  const sheet = 'lesson,key,translation,ok\r\nch05,beat.intro.title,"Titre revu dans le tableur",oui\r\n';
  await page.getByTestId('review-import').setInputFiles({
    name: 'review-fr.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(sheet),
  });
  await expect(page.getByText('Imported: 1 edited, 0 approved.')).toBeVisible();
  await expect(page.locator('textarea').filter({ hasText: 'Titre revu dans le tableur' })).toHaveCount(1);
});

test('the review page reads right to left in Arabic, with each text in its own direction', async ({ page }) => {
  await openStudio(page, { lang: 'ar' });
  await page.getByRole('button', { name: 'افتح الكتاب النموذجي' }).click();
  await expect(page).toHaveURL(/lesson\/ch05/);
  await page.goto('project/integers/review?lang=ar');
  await expect(page.getByRole('heading', { level: 1, name: 'مراجعة الترجمات' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(rows(page).first()).toBeVisible();
  // a sentence: English source, Arabic translation
  const row = rows(page)
    .filter({ has: page.locator('.review-source-text', { hasText: /[a-z]{4} [a-z]{3}/ }) })
    .first();
  await expect(row.locator('.review-source-text')).toHaveAttribute('dir', 'auto');
  await expect(row.locator('textarea')).toHaveAttribute('dir', 'auto');
  await expect(row.locator('textarea')).toHaveAttribute('lang', 'ar');
  // each text takes its own direction: the English source left to right, the Arabic translation right to left
  const dirs = await row.evaluate((el) => [
    getComputedStyle(el.querySelector('.review-source-text')!).direction,
    getComputedStyle(el.querySelector('textarea')!).direction,
  ]);
  expect(dirs).toEqual(['ltr', 'rtl']);
});
