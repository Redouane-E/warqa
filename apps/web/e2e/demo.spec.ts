// The example book, without any key: it opens in the lesson editor and plays with its recorded narration
// (audio served by the in-browser server through the service worker), then exports, and the exported book
// opens in a new tab.
import { expect, test } from '@playwright/test';
import { jobDone, serviceWorkerReady } from './helpers';

test('the example book opens and plays, then exports and opens in a new tab', async ({ page, context }) => {
  await page.goto('./');
  await serviceWorkerReady(page);
  await page.getByRole('button', { name: 'See a finished book first' }).click();
  await expect(page).toHaveURL(/\/warqa\/project\/integers\/lesson\/ch05$/);

  // the stage draws the beat being edited; "Play this beat" plays it
  await expect(page.locator('.stage-host .wq-player')).toBeVisible();
  await page.getByRole('button', { name: 'Play this beat' }).click();
  // the narration of the first beat is fetched (through the service worker) and plays
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          performance
            .getEntriesByType('resource')
            .filter(
              (e) =>
                /\/warqa\/api\/projects\/integers\/files\/lessons\/ch05\/audio\/[a-z]+\/[\w-]+\.mp3/.test(e.name) &&
                [200, 206].includes((e as PerformanceResourceTiming).responseStatus),
            ).length,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  // Preview lifts the same player to the whole window, with its bar; Close puts it back
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const lifted = page.locator('.stage-box.is-lifted');
  await expect(lifted.locator('.wq-stepname')).toContainText('1 / 14');
  await lifted.locator('.wq-next').click();
  await expect(lifted.locator('.wq-stepname')).toContainText('2 / 14');
  await lifted.getByRole('button', { name: 'Close' }).click();
  // the editor is on the beat the preview reached
  await expect(page).toHaveURL(/beat=2$/);

  // export the whole book in the browser, then open it like a published site
  await page.goto('project/integers?step=export');
  await page.getByRole('button', { name: 'Export the book' }).click();
  expect(await jobDone(page)).toContain('pill-done');
  const opened = context.waitForEvent('page');
  await page.locator('.step-panel').getByRole('link', { name: 'Open the book' }).click();
  const book = await opened;
  await expect(book).toHaveURL(/\/warqa\/books\/integers\/$/);
  await expect(book).toHaveTitle(/الأعداد الصحيحة/);
  await book.locator('a[href*="ch05"]').first().click();
  await expect(book.locator('.wq-player')).toBeVisible();
});
