// Making a book from a PDF, entirely in the browser, with the test-only scripted model (?warqa-fake=1, no
// network): the start guide creates the project and reads the PDF (pdf.js in the worker), the plan is drafted
// and approved, a chapter is built and translated, the book is exported and downloaded as a zip.
import { expect, test } from '@playwright/test';
import { fixture, jobDone, openStudio, step } from './helpers';

test('a PDF becomes a planned, built and exported book (test model)', async ({ page }) => {
  await page.goto('./?warqa-fake=1');
  await page.getByRole('button', { name: 'Make my first book' }).click();
  await page.getByRole('radio', { name: 'I teach' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
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
  // a short chip in the top bar; the whole sentence is its tooltip
  await expect(page.locator('.web-chip-test')).toHaveText('Test mode');
  await expect(page.locator('.web-chip-test')).toHaveAttribute('title', 'Test mode: scripted model, no network');
  await expect(page.getByRole('cell', { name: 'Chapter 1: Integers' })).toBeVisible({ timeout: 60_000 });
  // how each page was read: one tile per page, named for screen readers
  await expect(page.locator('.page-strip li')).toHaveCount(6);
  await expect(page.locator('.page-strip li').first()).toHaveAttribute('aria-label', 'Page 1, text layer');

  // plan: a table of contents whose cost follows the ticks before anything is saved
  await step(page, /Plan/).click();
  await page.getByRole('button', { name: 'Draft the plan' }).click();
  await expect(page.locator('.plan-chapter')).toHaveCount(4, { timeout: 60_000 });
  const bar = page.locator('.plan-bar');
  await expect(bar).toContainText('Making 3 chapters');
  await page.getByRole('checkbox', { name: 'Include chapter 4' }).uncheck();
  await expect(bar).toContainText('Making 2 chapters');
  await expect(bar).toContainText('Unsaved changes');
  await page.getByRole('checkbox', { name: 'Include chapter 4' }).check();
  // a new objective, typed on a new line, marks the chapter as changed until it is saved
  await page.locator('summary[aria-label="Edit the objectives of chapter 2"]').click();
  const box = page.getByRole('textbox', { name: 'Objectives of chapter 2, one per line' });
  await box.focus();
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await box.press('Enter');
  await box.pressSequentially('Read a thermometer');
  await expect(box).toHaveValue(/\nRead a thermometer$/);
  await expect(page.getByText('You added an objective')).toBeVisible();
  await page.getByRole('button', { name: 'Save the plan' }).click();
  await expect(page.getByText('You added an objective')).toBeHidden();
  await page.getByRole('button', { name: 'Approve the plan' }).click();
  await expect(page.locator('.toast')).toContainText('Plan approved');
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  // Undo puts the plan back to a draft, then it is approved again
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve the plan' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();

  // make the first chapter (storyboard, beats, French translation): its cost is shown before the click
  await step(page, /Make lessons/).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Make lessons' })).toBeVisible();
  const ch01 = page.locator('.make-row').first();
  await expect(ch01).toContainText('Not made yet');
  await expect(ch01).toContainText(/about \$/);
  await ch01.getByRole('button', { name: 'Make', exact: true }).click();
  expect(await jobDone(page)).toContain('pill-done');
  // done: the toast names the chapter, its beats and its cost
  await expect(page.locator('.toast')).toContainText(/Chapter \d+ is made · \d+ beats · \$/);
  await expect(ch01).toHaveClass(/is-made/);
  await expect(ch01.getByText('No problems')).toBeVisible();
  await expect(ch01.locator('.langs')).toContainText('fr');
  await expect(page.locator('.stepper')).toContainText(/1\/\d+/);
  // the tray keeps what happened: the chapter's stages and its beats as they were written
  await page.locator('.tray-pill-open').click();
  await expect(page.getByRole('list', { name: 'Stages' })).toBeVisible();
  expect(await page.locator('.build-tiles li').count()).toBeGreaterThan(2);
  await page.locator('.tray').getByRole('button', { name: 'Hide' }).click();
  // making it again would replace the teacher's edits: only this asks first
  await ch01.getByRole('button', { name: 'Make again' }).click();
  const dialog = page.locator('dialog.dialog');
  await expect(dialog).toContainText(/Make chapter \d+ again\?/);
  await dialog.getByRole('button', { name: 'Keep my lesson' }).click();
  await expect(dialog).toBeHidden();

  // the lesson opens in the editor and its preview plays
  await ch01.getByRole('link', { name: 'Edit' }).click();
  await expect(page.locator('.stage-host .wq-player')).toBeVisible();

  // a beat written again (its cost said first): the new version waits to be compared, then kept, then taken back
  const sheet = page.locator('.beat-sheet');
  if (!(await sheet.isVisible())) await page.getByRole('button', { name: 'Beat 1 details' }).click();
  await expect(sheet.locator('.regen')).toContainText(/about \$/);
  await sheet.getByRole('textbox', { name: 'What should change?' }).fill('Shorter.');
  await sheet.getByRole('button', { name: 'Regenerate', exact: true }).click();
  const rewritten = page.locator('.toast').filter({ hasText: 'Beat 1 rewritten' });
  await expect(rewritten).toBeVisible({ timeout: 60_000 });
  // from another beat, Compare goes back to beat 1 and shows its new version
  await page.locator('.beat-list .beat-btn').nth(1).click();
  await rewritten.getByRole('button', { name: 'Compare' }).click();
  await expect(sheet.getByRole('heading', { name: 'A new version is ready' })).toBeVisible();
  await expect(sheet.locator('.compare')).toContainText('Shorter.');
  await expect(sheet.getByRole('button', { name: 'After' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.stage-host .wq-player')).toBeVisible();
  await sheet.getByRole('button', { name: 'Keep the new version' }).click();
  const replaced = page.locator('.toast').filter({ hasText: 'Beat 1 replaced.' });
  await expect(replaced).toContainText('Translate it again into French.');
  await expect(sheet.getByRole('heading', { name: 'A new version is ready' })).toBeHidden();
  await replaced.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'The old version is back.' })).toBeVisible();

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
  // a new book opens in a side sheet
  await page.getByRole('button', { name: 'New book', exact: true }).click();
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
  // the scanned pages show as read by the vision model, in the strip and its legend
  await expect(page.locator('.read-legend')).toContainText('Vision model');
  await expect(page.locator('.page-strip li.is-ocr-vision').first()).toHaveAttribute('aria-label', /vision model/);
});
