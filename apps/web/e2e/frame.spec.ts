// The studio's frame (redesign phase 3): Go to, Esc closing the tool on top, Alt+↑, unsaved work asking before
// it is lost, ?beat and ?step, and the tray following you from screen to screen. Test model, nothing spends.
import { expect, type Page, test } from '@playwright/test';
import { confirmDialog, jobDone, openStudio } from './helpers';

async function exampleBook(page: Page) {
  await openStudio(page, { fake: true });
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers\/lesson\/ch05/);
}

test('Go to finds a step without starting any work, and the book page follows it', async ({ page }) => {
  await exampleBook(page);
  await page.goto('project/integers?step=make');
  await expect(page.locator('.station[aria-current="step"]')).toContainText('Make lessons');

  await page.keyboard.press('ControlOrMeta+k');
  const goto = page.getByRole('dialog', { name: 'Go to a book, a step or an action' });
  await expect(goto).toBeVisible();
  // Enter on the empty field chooses nothing: no job starts
  await page.keyboard.press('Enter');
  await expect(goto).toBeVisible();
  await expect(page.locator('.tray, .tray-pill')).toHaveCount(0);

  // a place comes before any action that would spend
  await page.keyboard.type('plan');
  await expect(goto.getByRole('option').first()).toContainText('2 · Plan');
  await page.keyboard.press('Enter');
  await expect(goto).toBeHidden();
  await expect(page).toHaveURL(/step=plan/);
  await expect(page.locator('.station[aria-current="step"]')).toContainText('Plan');
  // the browser's Back shows the step again
  await page.goBack();
  await expect(page.locator('.station[aria-current="step"]')).toContainText('Make lessons');
});

test('Esc closes the tool on top, one at a time, and never leaves the place', async ({ page }) => {
  await exampleBook(page);
  await page.goto('project/integers');
  await page.locator('.web-data-btn').click();
  const sheet = page.locator('.side-sheet');
  await expect(sheet).toBeVisible();
  await page.getByRole('button', { name: 'Interface language' }).click();
  await expect(page.getByRole('menu')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/project\/integers$/);
});

test('?beat opens a beat; Alt+↑ goes up a place, but not while typing or with unsaved work', async ({ page }) => {
  await exampleBook(page);
  await page.goto('project/integers/lesson/ch05?beat=3');
  await expect(page.locator('.beat-btn[aria-current="true"] .beat-n')).toHaveText('3');
  // the address follows the beat chosen
  await page.locator('.beat-btn').nth(4).click();
  await expect(page).toHaveURL(/beat=5/);

  // typing: Alt+↑ belongs to the text field
  const title = page.getByRole('textbox', { name: 'Title' }).first();
  await title.fill('A changed title');
  await title.press('Alt+ArrowUp');
  await expect(page).toHaveURL(/lesson\/ch05/);

  // unsaved work asks before it is lost; Stay keeps it
  await page.locator('.beat-btn').first().focus();
  await page.keyboard.press('Alt+ArrowUp');
  // the dialog names the beat and what would be lost
  await expect(page.locator('dialog.dialog')).toContainText('Leave without saving your changes to beat 5?');
  await expect(page.locator('dialog.dialog')).toContainText('The title will be lost.');
  await confirmDialog(page, 'Stay');
  await expect(page).toHaveURL(/lesson\/ch05/);
  await expect(title).toHaveValue('A changed title');
  // the strip leads up too, and leaving without saving is a choice
  await page.locator('.strips').getByRole('link').last().click();
  await confirmDialog(page, 'Leave without saving');
  await expect(page).toHaveURL(/\/project\/integers(\?step=\w+)?$/);
});

test('the tray follows you to other screens', async ({ page }) => {
  await exampleBook(page);
  await page.goto('project/integers?step=export');
  await page.getByRole('button', { name: 'Export the book' }).click();
  expect(await jobDone(page)).toContain('pill-done');
  // done: the tray folds to its pill and a message offers to open the book
  await expect(page.locator('.tray-pill')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Book ready');
  await page.locator('.strips').getByRole('link', { name: 'Books' }).click();
  await expect(page).toHaveURL(/\/warqa\/$/);
  await expect(page.locator('.tray-pill')).toBeVisible();
  await page.locator('.tray-pill-open').click();
  await expect(page.getByRole('region', { name: /Exporting/ })).toBeVisible();
});

test('Sheet or Board: the first visit follows the computer; one button switches, and it is remembered', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openStudio(page);
  // nothing chosen yet: the computer's dark mode shows the Board, and the button offers the Sheet
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  const toSheet = page.getByRole('button', { name: 'Light (Sheet)' });
  await expect(toSheet).toBeVisible();
  const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await ground();
  await toSheet.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Dark (Board)' })).toBeVisible();
  expect(await ground()).not.toBe(dark);
  // remembered
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Dark (Board)' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await ground()).toBe(dark);
});
