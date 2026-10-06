// The Share step in the browser (redesign 4f): export the book, then what it holds, Open, the zip and when it was
// exported; the other ways to share that work in a browser (SCORM, flashcards, a backup) and the one that needs the
// desktop (video). Nothing spends.
import { expect, test } from '@playwright/test';
import { jobDone, openStudio } from './helpers';

test('share the book: export it, the zip, SCORM, flashcards and a backup', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers/);
  await page.goto('project/integers?step=share');
  await expect(page.getByRole('heading', { level: 2, name: 'Share your book' })).toBeVisible();
  await page.getByRole('button', { name: 'Export the book' }).click();
  expect(await jobDone(page)).toContain('pill-done');
  await expect(page.getByRole('heading', { level: 2, name: 'Your book is ready' })).toBeVisible();
  await expect(page.locator('.share-facts')).toContainText(/questions/);
  await expect(page.getByRole('link', { name: /Download \.zip/ })).toBeVisible();
  await expect(page.getByText(/Last exported today at/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export again' })).toBeVisible();

  // SCORM for Moodle: made here, then downloaded
  await page.getByRole('button', { name: 'Make the SCORM package' }).click();
  const scorm = page.locator('.toast').filter({ hasText: 'SCORM package ready' });
  await expect(scorm).toBeVisible({ timeout: 60_000 });
  let download = page.waitForEvent('download');
  await scorm.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('integers-scorm.zip');

  // flashcards for Anki, in the book's first language
  download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download for Anki' }).click();
  expect((await download).suggestedFilename()).toMatch(/^integers-flashcards-\w+\.txt$/);

  // video needs the desktop version
  await expect(page.locator('.share-card').filter({ hasText: 'Video' })).toContainText('Desktop version only');

  // the backup of the whole book
  download = page.waitForEvent('download');
  await page.locator('.share-card').filter({ hasText: 'Backup' }).getByRole('button', { name: 'Download backup' }).click();
  expect((await download).suggestedFilename()).toBe('integers.warqa.zip');
});
