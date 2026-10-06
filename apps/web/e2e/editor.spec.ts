// The lesson editor's inspector (redesign 4d2): forms generated from the lesson format edit a part on the stage,
// a cue and a question; Edit as JSON is the escape hatch; the change saves. Its marks (4d3): the timeline, the
// narration and the cues choose one mark, threads show what it moves. The example book, nothing spends.
import { expect, test } from '@playwright/test';
import { openStudio } from './helpers';

test('the inspector edits a part, a cue and a question from their definitions', async ({ page }) => {
  await openStudio(page, { fake: true });
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers\/lesson\/ch05/);
  await page.goto('project/integers/lesson/ch05?beat=3');
  const sheet = page.locator('.beat-sheet');
  await expect(sheet.getByRole('heading', { name: /Add the opposite/ })).toBeVisible();

  // a part on the stage: its form comes from its component's definition; its text is translated
  await sheet.getByRole('button', { name: 'Edit Text cap2' }).click();
  const part = sheet.locator('.node-editor');
  await part.getByRole('textbox', { name: 'Text', exact: true }).fill('Subtracting = adding the opposite');
  await expect(part).toContainText('Translated into French, Arabic');
  await expect(page.locator('.save-state')).toContainText('Unsaved changes');

  // a cue: what it does, from the generic actions and the part's own
  await sheet.locator('.cue-line').first().click();
  const cue = sheet.locator('.cue-editor');
  await cue.getByLabel('Action').selectOption('pulse');
  await cue.getByRole('button', { name: 'Done' }).click();
  await expect(sheet.locator('.cue-line').first()).toContainText('Pulse');

  // the stage part that a later beat keeps leads back to the beat that added it
  await expect(sheet.getByRole('button', { name: 'Go to beat 2' })).toBeVisible();

  // save: the problems stay as they were (nothing broke)
  await page.getByRole('button', { name: 'Save lesson' }).click();
  await expect(page.locator('.save-state')).toContainText('Saved');

  // a question: its form is the definition of its kind
  await page.goto('project/integers/lesson/ch05?beat=6');
  await sheet.getByRole('button', { name: 'Edit question 1' }).click();
  await expect(sheet.getByRole('textbox', { name: 'Question' })).toHaveValue(/\$4 − \(−9\)\$/);
  await expect(sheet.getByRole('group', { name: 'Options' })).toBeVisible();

  // Edit as JSON, then back to the form
  await sheet.getByRole('button', { name: 'Edit as JSON' }).click();
  await expect(sheet.getByRole('textbox', { name: 'This beat as JSON' })).toHaveValue(/"questions"/);
  await sheet.getByRole('button', { name: 'Back to the form' }).click();
  await expect(sheet.getByRole('heading', { name: 'Questions' })).toBeVisible();
});

test('a mark chosen on the timeline, in the narration or by its cue is the same mark; threads show what it moves', async ({
  page,
}) => {
  await openStudio(page, { fake: true });
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers\/lesson\/ch05/);
  await page.goto('project/integers/lesson/ch05?beat=3');
  await expect(page.locator('.stage-host .wq-player')).toBeVisible();
  const timeline = page.getByRole('group', { name: "Marks on the beat's timeline" });
  const sheet = page.locator('.beat-sheet');

  // the timeline: the mark is chosen everywhere, and the stage shows what it moves (boxed, with its thread)
  await timeline.getByRole('button', { name: 'keep', exact: true }).click();
  await expect(timeline.getByRole('button', { name: 'keep', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.narr-chip.is-sel')).toContainText('[[keep]]');
  await expect(sheet.locator('.cue-group.is-sel')).toContainText('keep');
  await expect(page.locator('.threads .is-sel .th-line').first()).toBeAttached();
  await expect(page.locator('.th-target')).toHaveCount(2);

  // the caret in another mark of the narration chooses that one
  const box = page.getByRole('textbox', { name: 'Narration' });
  await box.evaluate((el: HTMLTextAreaElement) => {
    const at = el.value.indexOf('[[chg1]]') + 2;
    el.focus();
    el.setSelectionRange(at, at);
  });
  await box.press('ArrowRight');
  await expect(page.locator('.narr-chip.is-sel')).toContainText('[[chg1]]');
  await expect(timeline.getByRole('button', { name: 'chg1', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // a new mark goes before the word the caret is in
  await page.getByRole('button', { name: 'Add a mark' }).click();
  await page.getByRole('textbox', { name: 'Mark name' }).fill('swap');
  await page.locator('.narr-add').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(box).toHaveValue(/\[\[swap\]\]\[\[chg1\]\]Change/);
  await expect(page.locator('.save-state')).toContainText('Unsaved changes');

  // the threads can be hidden, and stay hidden
  await page.getByRole('checkbox', { name: 'Show what each mark moves' }).uncheck();
  await expect(page.locator('.threads')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('warqa-studio:threads'))).toBe('0');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the inspector comes up from the bottom, in Arabic, without sideways scrolling', async ({ page }) => {
    await openStudio(page, { fake: true, lang: 'ar' });
    await page.getByRole('button', { name: 'افتح الكتاب النموذجي' }).click();
    await expect(page).toHaveURL(/project\/integers\/lesson\/ch05/);
    await page.goto('project/integers/lesson/ch05?beat=3');
    await page.getByRole('button', { name: 'تفاصيل المقطع 3' }).click();
    const sheet = page.locator('.beat-sheet');
    await expect(sheet.getByRole('heading', { name: 'ما تفعله كل علامة' })).toBeVisible();
    await sheet.locator('.cue-line').first().click();
    await expect(sheet.locator('.cue-editor')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
