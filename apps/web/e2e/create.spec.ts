// Making a book from a PDF, entirely in the browser, with the test-only scripted model (?warqa-fake=1, no
// network): the start guide creates the project and reads the PDF (pdf.js in the worker), the plan is drafted
// and approved, a chapter is built and translated, the book is exported and downloaded as a zip.
import { expect, test } from '@playwright/test';
import { fixture, jobDone, openStudio, step } from './helpers';

test('a PDF becomes a planned, built and exported book (test model)', async ({ page }) => {
  await page.goto('./?warqa-fake=1');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome to Warqa' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('radio', { name: /Test model/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('pdf-input').setInputFiles(fixture('textbook-en.pdf'));
  await expect(page.getByText('textbook-en.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: 'Arabic' }).uncheck();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Limit in US dollars')).toHaveValue('1');
  await page.getByRole('button', { name: 'Create the book' }).click();

  // read: the guide started it
  await expect(page).toHaveURL(/\/warqa\/project\/textbook-en/);
  await expect(page.getByText('Test mode: scripted model, no network')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Chapter 1: Integers' })).toBeVisible({ timeout: 60_000 });

  // plan
  await step(page, /Plan/).click();
  await page.getByRole('button', { name: 'Draft the plan' }).click();
  await expect(page.locator('.plan-chapter')).toHaveCount(4, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Approve the plan' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  // make the first chapter (storyboard, beats, French translation)
  await step(page, /Make lessons/).click();
  const ch01 = page.locator('.chapter', { hasText: 'ch01' });
  await ch01.getByRole('button', { name: 'Make' }).click();
  expect(await jobDone(page)).toContain('pill-done');
  await expect(ch01).toHaveClass(/is-made/);
  await expect(ch01.getByText('No errors')).toBeVisible();
  await expect(ch01.locator('.langs')).toContainText('FR');

  // the lesson opens in the editor and its preview plays
  await ch01.getByRole('link', { name: 'Edit' }).click();
  await expect(page.locator('.preview .wq-player')).toBeVisible();

  // export and download the book as a zip
  await page.goto('project/textbook-en?step=export');
  await page.getByRole('button', { name: 'Export the book' }).click();
  expect(await jobDone(page)).toContain('pill-done');
  const href = await page.getByRole('link', { name: 'Download .zip' }).getAttribute('href');
  expect(href).toBe('/warqa/api/projects/textbook-en/download');
  const zip = await page.evaluate(async (u) => {
    const r = await fetch(u!);
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type'), size: b.length, magic: String.fromCharCode(b[0]!, b[1]!) };
  }, href);
  expect(zip).toMatchObject({ status: 200, type: 'application/zip', magic: 'PK' });
  expect(zip.size).toBeGreaterThan(50_000);

  // the project backup downloads too
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  expect((await download).suggestedFilename()).toBe('textbook-en.warqa.zip');
});

test('a scanned PDF is rendered in the browser and read by the (test) vision model', async ({ page }) => {
  await openStudio(page, { fake: true });
  // with no book yet, the new-book form is already open
  await expect(page.locator('.new-book')).toBeVisible();
  await page.locator('.new-book input[type=file]').setInputFiles(fixture('scanned.pdf'));
  await page.locator('.new-book').getByRole('checkbox', { name: 'Arabic' }).uncheck();
  await page.locator('.new-book').getByRole('checkbox', { name: 'French' }).uncheck();
  await page.getByRole('button', { name: 'Create book' }).click();
  await expect(page).toHaveURL(/\/warqa\/project\/scanned/);
  // books made outside the guide pick their models from the keys; this one is told to use the test model
  await page.evaluate(async () => {
    const roles = ['planner', 'storyboard', 'writer', 'translator', 'vision', 'judge'];
    const r = await fetch('/warqa/api/projects/scanned/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ models: Object.fromEntries(roles.map((x) => [x, 'fake:scripted'])) }),
    });
    if (!r.ok) throw new Error(await r.text());
  });
  await page.goto('project/scanned?step=read');
  await page.locator('.step-panel').getByRole('button', { name: 'Read the PDF' }).click();
  expect(await jobDone(page)).toContain('pill-done');
  await expect(page.locator('.methods')).toContainText('vision model');
});
