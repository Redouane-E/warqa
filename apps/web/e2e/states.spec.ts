// When work stops or waits (redesign 4h), in the browser with the scripted model and scripted failures
// (?warqa-fake-fail=…): a service asking to slow down (a countdown and Try now), an answer cut off (the chapter
// stops at that beat and goes on from there), a refused key (where to paste a new one), the spending limit
// reached (raise it and go on). No network, nothing spent.
import { expect, type Page, test } from '@playwright/test';
import { fixture, step } from './helpers';

/** Start work with `act`, then wait for that job (the newest of the book) to end; its final status. */
async function ended(page: Page, act: () => Promise<void>): Promise<string> {
  const list = () =>
    page.evaluate(async () => {
      const r = await fetch('/warqa/api/projects/textbook-en/jobs');
      return ((await r.json()) as { jobs: { status: string; created: number }[] }).jobs;
    });
  const before = (await list()).length;
  await act();
  let status = '';
  await expect
    .poll(
      async () => {
        const jobs = await list();
        const newest = jobs.sort((x, y) => y.created - x.created)[0];
        status = jobs.length > before && newest ? newest.status : 'waiting';
        return ['done', 'error', 'cancelled'].includes(status);
      },
      { timeout: 90_000 },
    )
    .toBe(true);
  return status;
}

/** A new book from the test PDF through the start guide, read, planned and approved, on its Make step. */
async function bookAtMake(page: Page, fail: string) {
  await page.goto(`./?warqa-fake=1&warqa-fake-fail=${encodeURIComponent(fail)}`);
  await page.getByRole('button', { name: 'Make my first book' }).click();
  await page.getByRole('radio', { name: 'I teach' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /Test model/ }).check();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByTestId('pdf-input').setInputFiles(fixture('textbook-en.pdf'));
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox', { name: 'Arabic' }).uncheck();
  await page.getByRole('checkbox', { name: 'French' }).uncheck();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Create the book' }).click();
  await expect(page.getByRole('cell', { name: 'Chapter 1: Integers' })).toBeVisible({ timeout: 60_000 });
  await step(page, /Plan/).click();
  await page.getByRole('button', { name: 'Draft the plan' }).click();
  await expect(page.locator('.plan-chapter')).toHaveCount(4, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Approve the plan' }).click();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await step(page, /Make lessons/).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Make lessons' })).toBeVisible();
}

test('a service asks to slow down, then an answer is cut off: the chapter goes on from that beat', async ({ page }) => {
  await bookAtMake(page, 'rate:storyboard,cut:beat:*:q1');
  const ch01 = page.locator('.make-row').first();
  const status = await ended(page, async () => {
    await ch01.getByRole('button', { name: 'Make', exact: true }).click();
    // the wait: who asked, a countdown, and Try now
    const tray = page.locator('.tray');
    await expect(tray.locator('.rate-wait')).toContainText(/asked Warqa to slow down\. Trying again in 0:0\d/);
    await expect(tray.locator('.rate-wait')).toContainText('Finished work is kept.');
    await tray.getByRole('button', { name: 'Try now' }).click();
    await expect(tray.locator('.rate-wait')).toHaveCount(0);
  });
  // beat 3's answer is cut off: the chapter stops there, beats 1 and 2 kept
  expect(status).toBe('error');
  await expect(ch01).toContainText('stopped at beat 3');
  await expect(ch01).toContainText("The model's answer was cut off while writing beat 3. Beats 1 to 2 are kept.");
  const go = ch01.getByRole('button', { name: 'Continue from beat 3' });
  await expect(go).toHaveClass(/btn-primary/);
  expect(await ended(page, () => go.click())).toBe('done');
  await expect(ch01).toHaveClass(/is-made/);
});

test('a refused key says which service, and where to paste a new one', async ({ page }) => {
  await bookAtMake(page, 'key:storyboard');
  const status = await ended(page, () =>
    page.locator('.make-row').first().getByRole('button', { name: 'Make', exact: true }).click(),
  );
  expect(status).toBe('error');
  await page.locator('.tray-pill-open').click();
  const card = page.locator('.tray .callout-pen');
  await expect(card).toContainText('refused this key (HTTP 401)');
  await expect(card).toContainText('Nothing was charged.');
  // the Make step says it too
  await expect(page.locator('.make-sheet .callout-pen')).toContainText('refused this key');
  // a phone: nothing scrolls sideways
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 900 });
  await card.getByRole('button', { name: 'Paste a new key' }).click();
  await expect(page).toHaveURL(/\/ai#key-fake$/);
});

test('the spending limit reached: raise it, and the chapter goes on', async ({ page }) => {
  await bookAtMake(page, 'budget:beat:*:rule');
  const ch01 = page.locator('.make-row').first();
  expect(await ended(page, () => ch01.getByRole('button', { name: 'Make', exact: true }).click())).toBe('error');
  const notice = page.locator('.make-sheet .callout-pen');
  await expect(notice).toContainText('Your limit of $1.00 is reached. Chapter 1 stopped after beat 1');
  await notice.getByRole('button', { name: 'Raise the limit' }).click();
  const dialog = page.locator('dialog.limit-dialog');
  await expect(dialog).toBeVisible();
  // the safe choice has the focus; a limit under what was spent is refused
  await expect(dialog.getByRole('button', { name: 'Keep $1.00' })).toBeFocused();
  await dialog.getByLabel('New limit').fill('0.50');
  await expect(dialog).toContainText('Choose more than $1.00');
  await dialog.getByLabel('New limit').fill('3');
  expect(
    await ended(page, async () => {
      await dialog.getByRole('button', { name: 'Raise to $3.00' }).click();
      await expect(dialog).toBeHidden();
    }),
  ).toBe('done');
  await expect(ch01).toHaveClass(/is-made/);
  await expect(page.locator('.spend-chip')).toContainText('$3.00');
});
