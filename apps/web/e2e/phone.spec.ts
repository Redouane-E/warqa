// The studio on a phone (redesign phase 5), at 390 px in English and Arabic: the header with its back arrow, the
// six steps in a row, bottom sheets with a handle, menus at the bottom, dialogs under the thumb, Go to on the whole
// screen; then the studio's keys on a computer.
import { expect, type Page, test } from '@playwright/test';
import { openStudio, step } from './helpers';

async function example(page: Page, lang = 'en') {
  await openStudio(page, { lang });
  await page.getByRole('button', { name: lang === 'ar' ? 'افتح الكتاب النموذجي' : 'Open the example book' }).click();
  await expect(page).toHaveURL(/lesson\/ch05/);
}
const noSideways = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  for (const lang of ['en', 'ar'] as const) {
    test(`a book (${lang}): the back arrow, the six steps in a row, nothing sideways`, async ({ page }) => {
      await example(page, lang);
      await page.goto('project/integers?step=make');
      const back = page.locator('.topbar-back');
      await expect(back).toBeVisible();
      await expect(back).toHaveAccessibleName(lang === 'ar' ? 'الكتب' : 'Books');
      await expect(page.locator('.topbar-place')).toHaveText(
        lang === 'ar' ? 'الأعداد الصحيحة النسبية خطوة بخطوة' : 'Integers, step by step',
      );
      await expect(page.locator('.strips')).toBeHidden();
      const ol = page.locator('.stepper ol');
      expect(await ol.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
      await expect(page.locator('.station-short')).toHaveCount(6);
      // the short name shows; screen readers keep the full one
      await expect(page.locator('.stepper .station').nth(2)).toHaveAccessibleName(
        lang === 'ar' ? /إنشاء الدروس/ : /Make lessons/,
      );
      await noSideways(page);
      // back to Your books
      await back.click();
      await expect(page).toHaveURL(/\/warqa\/$/);
    });
  }

  test('New book is a bottom sheet with a handle; Esc closes it and the focus comes back', async ({ page }) => {
    await example(page);
    await page.goto('./');
    const opener = page.getByRole('button', { name: 'New book' }).first();
    await opener.click();
    const sheet = page.getByRole('dialog', { name: 'New book' });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.sheet-grip')).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(830);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('the menu is a list at the bottom; a dialog sits at the bottom; Go to takes the screen', async ({ page }) => {
    await example(page);
    await page.goto('project/integers?step=make');
    await page.getByRole('button', { name: 'Menu' }).click();
    const menu = page.locator('.phone-menu [role="menu"]');
    await expect(menu).toBeVisible();
    const row = (await menu.getByRole('menuitemradio', { name: 'Français' }).boundingBox())!;
    expect(row.height).toBeGreaterThanOrEqual(56);
    // (once it has risen into place)
    await expect
      .poll(async () => {
        const mb = (await page.locator('.phone-menu .menu').boundingBox())!;
        return Math.round(mb.y + mb.height);
      })
      .toBe(844);
    await page.keyboard.press('Escape');
    // deleting a book: the dialog under the thumb
    await page.getByRole('button', { name: 'Delete this book from this browser' }).click();
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toBeVisible();
    const db = (await dialog.boundingBox())!;
    expect(844 - (db.y + db.height)).toBeLessThan(16);
    await dialog.getByRole('button', { name: 'Keep the book' }).click();
    // Go to, from the header, on the whole screen
    await page.locator('.goto-btn').click();
    const goto = page.locator('.goto');
    await expect(goto).toBeVisible();
    // (once its opening motion is over)
    await expect.poll(async () => Math.round((await goto.boundingBox())!.y)).toBeLessThanOrEqual(1);
    expect((await goto.boundingBox())!.width).toBeGreaterThanOrEqual(389);
    await expect(page.locator('.goto-foot')).toBeHidden();
  });

  test('the menu’s AI and voices asks first when the lesson has unsaved work', async ({ page }) => {
    await example(page);
    // (on a phone the beat's title is in its details, at half height)
    await page.locator('.beat-btn').first().click();
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Title' }).first().fill('Not saved yet');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'AI and voices' }).click();
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/lesson\/ch05/);
  });

  test('the beat inspector opens at half height; its handle takes it to full', async ({ page }) => {
    await example(page);
    await page.locator('.beat-btn').first().click();
    await page.keyboard.press('Enter');
    const sheet = page.locator('.side-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveClass(/is-half/);
    const half = (await sheet.boundingBox())!.height;
    expect(half).toBeLessThan(844 * 0.6);
    await sheet.locator('.sheet-grip').click();
    await expect(sheet).toHaveClass(/is-full/);
    await expect.poll(async () => (await sheet.boundingBox())!.height).toBeGreaterThan(760);
  });
});

test.describe('keys on a computer', () => {
  test('? lists every shortcut (but types in a field); Esc closes it', async ({ page }) => {
    await example(page);
    await page.goto('project/integers?step=make');
    await expect(page.locator('.stepper')).toBeVisible();
    await page.keyboard.press('Shift+Slash');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Jump to a step');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    // in a field, ? is a question mark
    await page.locator('.goto-btn').click();
    await page.getByRole('combobox').pressSequentially('what?');
    await expect(page.getByRole('combobox')).toHaveValue('what?');
    await expect(sheet).toBeHidden();
    // and Go to says how it works
    await expect(page.locator('.goto-foot')).toContainText('Enter to open');
  });

  test('Alt + 3 goes to Make; in the editor with unsaved work it asks first', async ({ page }) => {
    await example(page);
    await page.goto('project/integers?step=read');
    await expect(page.locator('.stepper')).toBeVisible();
    await page.keyboard.press('Alt+Digit3');
    await expect(page).toHaveURL(/step=make/);
    await page.goto('project/integers/lesson/ch05');
    await page.getByRole('textbox', { name: 'Title' }).first().fill('A new title');
    await page.locator('.beat-btn').first().focus();
    await page.keyboard.press('Alt+Digit3');
    const dialog = page.locator('dialog.dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(page).toHaveURL(/lesson\/ch05/);
  });

  test('Ctrl or ⌘ S saves the lesson on an Arabic keyboard (the key, not the letter)', async ({ page }) => {
    await example(page);
    await page.getByRole('textbox', { name: 'Title' }).first().fill('Subtracting, saved by key');
    const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform));
    await page.evaluate((m) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'س', code: 'KeyS', metaKey: m, ctrlKey: !m, bubbles: true, cancelable: true }),
      );
    }, mac);
    await expect(page.getByText(/^Saved$|Saved/).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Title' }).first()).toHaveValue('Subtracting, saved by key');
  });

  test('the step rail is one stop; the arrow keys move along it (mirrored in Arabic)', async ({ page }) => {
    await example(page);
    await page.goto('project/integers?step=plan');
    const stations = page.locator('.stepper .station');
    await expect(stations.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(stations.nth(0)).toHaveAttribute('tabindex', '-1');
    await stations.nth(1).focus();
    await page.keyboard.press('ArrowDown');
    await expect(stations.nth(2)).toBeFocused();
    await page.keyboard.press('End');
    await expect(stations.nth(5)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(stations.nth(0)).toBeFocused();
    // the skip link goes straight to the step
    await expect(page.locator('a.skip')).toHaveText('Skip to the step');
    await page.evaluate(() => localStorage.setItem('warqa-studio:lang', 'ar'));
    await page.reload();
    await step(page, /الخطة/).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(stations.nth(2)).toBeFocused();
  });
});
