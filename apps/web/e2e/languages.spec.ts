// Translate & narrate in the browser, on the example book (redesign 4e): the language cards, then one language's
// review queue: approve, correct, approve what is shown (with Undo), the spreadsheet round trip with its preview, a
// lost mark put back, an original that changed (keep the wording, or translate it again with the test model), the old
// addresses, and Arabic with each text in its own direction. Nothing spends: the test model.
import { expect, type Page, test } from '@playwright/test';
import { openStudio } from './helpers';

const rows = (page: Page) => page.locator('.rv-row');
const pill = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Show' }).getByRole('button', { name });

/** Change the original of some texts of ch05 (as an author editing the lesson does). */
async function editOriginal(page: Page, beats: Record<string, string>) {
  await page.evaluate(async (titles) => {
    const url = '/warqa/api/projects/integers/lessons/ch05';
    const d = (await (await fetch(url)).json()) as { lesson: { beats: { id: string; title: string }[] } };
    for (const b of d.lesson.beats) if (titles[b.id]) b.title = titles[b.id]!;
    const r = await fetch(`${url}?force=1`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(d.lesson),
    });
    if (!r.ok) throw new Error(await r.text());
  }, beats);
}

test('translate & narrate: the languages, and reviewing the French', async ({ page }) => {
  await openStudio(page, { fake: true });
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/lesson\/ch05/);
  await page.goto('project/integers?step=voice');
  await expect(page.getByRole('heading', { level: 2, name: 'Translate & narrate' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Your wording is kept');
  // the cards: the original, and each translation with how much a person checked
  await expect(page.getByRole('region', { name: /^English/ })).toContainText('Original');
  await expect(page.getByRole('region', { name: /^Français/ })).toContainText(/translated · \d+ checked by a person/);
  // the example book has no voice in the web app: captions only, and where to change it
  await expect(page.getByRole('region', { name: /^English/ })).toContainText('No voice · captions only');
  await expect(page.getByRole('heading', { level: 2, name: 'Review the French' })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();

  // approve one string, correct another
  const model = rows(page).filter({ hasText: 'Made by the model' });
  const first = model.first();
  const firstWhere = await first.locator('.rv-where').innerText();
  await first.getByRole('button', { name: 'Approve' }).click();
  const approved = rows(page).filter({ hasText: firstWhere }).first();
  await expect(approved).toContainText('Checked by a person · you');
  const second = rows(page).filter({ hasText: 'Made by the model' }).first();
  const box = second.getByRole('textbox');
  await box.fill(`${await box.inputValue()} (relu)`);
  await second.getByRole('button', { name: 'Save my wording' }).click();
  await expect(rows(page).filter({ hasText: '(relu)' })).toContainText('Checked by a person');

  // the "checked by a person" filter shows them
  await pill(page, /^Checked by a person/).click();
  await expect(rows(page)).toHaveCount(2);
  await pill(page, /^All/).click();

  // approve what is shown: no dialog, Undo in the toast
  await page.getByRole('button', { name: /^Approve the \d+ strings shown/ }).click();
  const toast = page.locator('.toast').filter({ hasText: /strings approved/ });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Approvals withdrawn.' })).toBeVisible();
  await expect(pill(page, /^Checked by a person/)).toContainText('2');

  // the spreadsheet: download, then import a reviewed one (what it changes is shown first)
  const href = await page.getByRole('link', { name: 'Download spreadsheet' }).getAttribute('href');
  expect(href).toBe('/warqa/api/projects/integers/review/fr.csv');
  const csv = await page.evaluate(async (u) => (await fetch(u!)).text(), href);
  expect(csv.split('\r\n')[0]).toContain('lesson,key,where,state,problems,source,translation,ok');
  const sheet = 'lesson,key,translation,ok\r\nch05,beat.rule.title,"Titre revu dans le tableur",oui\r\n';
  await page.getByTestId('review-import').setInputFiles({
    name: 'review-fr.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(sheet),
  });
  const preview = page.getByRole('dialog', { name: 'What will change' }).or(page.locator('.rv-import'));
  await expect(preview.getByText('Titre revu dans le tableur')).toBeVisible();
  await preview.getByRole('button', { name: 'Apply 1 change' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Imported: 1 edited, 0 approved.' })).toBeVisible();

  // a lost mark: approving waits, "Put … back" puts it where it belongs
  const narr = rows(page)
    .filter({ hasText: 'narration' })
    .filter({ has: page.locator('.tok-raw-mark') })
    .first();
  const nbox = narr.getByRole('textbox');
  const text = await nbox.inputValue();
  const mark = /\[\[([\w-]+)\]\]/.exec(text)![1]!;
  await nbox.fill(text.replace(`[[${mark}]]`, ''));
  await expect(narr).toContainText(`The mark ${mark} is missing`);
  await expect(narr.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await narr.getByRole('button', { name: `Put ${mark} back` }).click();
  await expect(narr).not.toContainText('is missing');
  await expect(nbox).toHaveValue(new RegExp(`\\[\\[${mark}\\]\\]`));

  // a reload keeps the review (it is saved in the browser)
  await page.reload();
  await pill(page, /^Checked by a person/).click();
  await expect.poll(() => rows(page).count()).toBeGreaterThanOrEqual(3);

  // the author changes two originals: their translations say so; one is kept, the other translated again (by the
  // test model, the book's translator from now on)
  await page.evaluate(async () => {
    const r = await fetch('/warqa/api/projects/integers/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ models: { translator: 'fake:scripted' } }),
    });
    if (!r.ok) throw new Error(await r.text());
  });
  await editOriginal(page, { intro: 'Subtracting, told again', inverse: 'Opposite numbers' });
  await page.reload();
  await pill(page, /^Original changed/).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText('Changed after it was translated');
  await rows(page).first().getByRole('button', { name: 'Keep mine' }).click();
  await expect(rows(page).first()).toContainText('Checked by a person');
  await rows(page).nth(1).getByRole('button', { name: 'Translate again' }).click();
  await expect(rows(page).nth(1)).toContainText('Made by the model', { timeout: 30_000 });

  // the old addresses land here: the book-wide review, and the editor's Translations tab
  await page.goto('project/integers/review?lang=ar');
  await expect(page).toHaveURL(/step=voice&lang=ar/);
  await expect(page.getByRole('heading', { level: 2, name: 'Review the Arabic' })).toBeVisible();
  await page.goto('project/integers/lesson/ch05?tab=translations');
  await expect(page).toHaveURL(/step=voice&chapter=ch05/);
});

test('translate & narrate reads right to left in Arabic, with each text in its own direction', async ({ page }) => {
  await openStudio(page, { lang: 'ar' });
  await page.getByRole('button', { name: 'افتح الكتاب النموذجي' }).click();
  await expect(page).toHaveURL(/lesson\/ch05/);
  await page.goto('project/integers?step=voice&lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 2, name: 'الترجمة والتعليق الصوتي' })).toBeVisible();
  const row = rows(page)
    .filter({ has: page.locator('.rv-source', { hasText: /[a-z]{4} [a-z]{3}/ }) })
    .first();
  await expect(row.locator('.rv-source')).toHaveAttribute('lang', 'en');
  await expect(row.getByRole('textbox')).toBeVisible();
  // each text takes its own direction: the English original left to right, the Arabic translation right to left;
  // marks and formulas stay left to right inside either
  const dirs = await row.evaluate((el) => [
    getComputedStyle(el.querySelector('.rv-source')!).direction,
    getComputedStyle(el.querySelector('textarea')!).direction,
  ]);
  expect(dirs).toEqual(['ltr', 'rtl']);
  const tok = row.locator('.tok').first();
  if (await tok.count()) await expect(tok).toHaveAttribute('dir', 'ltr');
});
