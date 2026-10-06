// AI and voices and Book settings in the browser (redesign 4g): the page's four parts, a key added and removed
// (with Undo), the model set and a role of its own (Custom), the voices (Edge needs the desktop version; a sample
// read by the test engine), new books starting from the defaults, and a book's settings as a sheet over the book.
// Nothing spends: test mode, and keys are added through the API (a check would ask the real service).
import { expect, type Page, test } from '@playwright/test';
import { confirmDialog, openStudio } from './helpers';

const api = <T = Record<string, unknown>>(page: Page, method: string, path: string, body?: unknown): Promise<T> =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(`/warqa${p}`, {
        method: m,
        headers: { 'content-type': 'application/json' },
        ...(b !== undefined ? { body: JSON.stringify(b) } : {}),
      });
      return r.json();
    },
    [method, path, body] as const,
  ) as Promise<T>;

test('AI and voices: keys, the model set, who does what and the voices', async ({ page }) => {
  await openStudio(page, { fake: true });
  // the old address leads here
  await page.goto('settings');
  await expect(page).toHaveURL(/\/warqa\/ai$/);
  await expect(page.getByRole('heading', { level: 1, name: 'AI and voices' })).toBeVisible();
  await expect(page.locator('.topbar-link')).toHaveAttribute('aria-current', 'page');
  const nav = page.getByRole('navigation', { name: 'On this page' });
  await expect(nav.getByRole('link')).toHaveText([/^Keys/, /^Model set/, /^Who does what/, /^Voices/]);

  // a key shows as ready with its last four characters; Remove keeps the row, and Undo puts the key back
  await api(page, 'PUT', '/api/keys', { MISTRAL_API_KEY: 'test-dummy-key-0000wxyz' });
  await page.reload();
  const mistral = page.locator('#key-mistral');
  await expect(mistral).toContainText('Ready · on this device');
  await expect(mistral).toContainText('•••• wxyz');
  await mistral.getByRole('button', { name: 'Remove the Mistral key' }).click();
  await expect(mistral).toContainText('No key yet');
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
  await expect(mistral).toContainText('•••• wxyz');

  // another service opens a row with its field; Cancel folds it
  await page.locator('.key-others').getByRole('button', { name: 'Groq' }).click();
  await expect(page.getByLabel('Groq key', { exact: true })).toBeFocused();
  await page.locator('#key-groq').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Groq key', { exact: true })).toHaveCount(0);

  // a set whose key is missing cannot be chosen, and says which key it needs
  const set = page.locator('#set');
  await expect(set.getByRole('radio', { name: /^Budget/ })).toBeDisabled();
  await expect(set.locator('.set-card', { hasText: /^Budget/ })).toContainText('Needs a DeepSeek key');
  // with only a Mistral key, its set is the one in use; choosing another saves it (for new books)
  await expect(set.getByRole('radio', { name: /^Mistral only/ })).toBeChecked();
  await set.getByRole('radio', { name: /^Private/ }).check();
  await expect(set.locator('.ai-saved')).toHaveClass(/is-on/);
  await set.getByRole('radio', { name: /^Mistral only/ }).check();
  await expect(set.locator('.ai-saved')).toHaveClass(/is-on/);
  await page.reload();
  await expect(page.locator('#set').getByRole('radio', { name: /^Mistral only/ })).toBeChecked();
  expect((await api<{ preset?: string }>(page, 'GET', '/api/defaults')).preset).toBe('mistral');

  // a role with a model of its own makes the set Custom; "From the set" undoes it
  const writer = page.getByRole('combobox', { name: 'Model for the writer' });
  await writer.selectOption('mistral:mistral-small-latest');
  await expect(page.locator('#set').getByRole('radio', { name: /^Custom/ })).toBeChecked();
  await writer.selectOption('');
  await expect(page.locator('#set').getByRole('radio', { name: /^Mistral only/ })).toBeChecked();

  // voices: Edge needs the desktop version
  const engine = page.getByLabel('Speech engine');
  await expect(engine.locator('option[value="edge"]')).toBeDisabled();
  await expect(page.locator('#voices')).toContainText('Edge voices are free, but need the desktop version.');
  await engine.selectOption('gemini');
  // each language has a sample (the test engine reads it as silence); a second play is not made again
  const sample = page.getByRole('button', { name: /^Play a sample in French/ });
  await sample.click();
  await expect(page.getByRole('button', { name: 'Stop the sample' })).toBeVisible();
  const again = await api<{ cached: boolean }>(page, 'POST', '/api/voices/sample', {
    engine: 'gemini',
    voice: 'Kore',
    lang: 'fr',
  });
  expect(again.cached).toBe(true);
  // no voice: nothing to choose per language
  await engine.selectOption('none');
  await expect(page.locator('.voice-list')).toHaveCount(0);

  // forget all keys
  await page.getByRole('button', { name: 'Forget all my keys' }).click();
  await confirmDialog(page, 'Forget all keys');
  await expect(mistral).toContainText('No key yet');
});

test('new books start from the defaults; Book settings is a sheet over the book', async ({ page }) => {
  await openStudio(page, { fake: true });
  await api(page, 'PUT', '/api/defaults', { preset: 'google', tts: { provider: 'gemini', voices: { fr: 'Aoede' } } });
  const made = await page.evaluate(async () => {
    const f = new FormData();
    f.set('title', 'Starts from the defaults');
    f.set('langs', 'ar,fr');
    f.set('defaultLang', 'ar');
    return ((await (await fetch('/warqa/api/projects', { method: 'POST', body: f })).json()) as { id: string }).id;
  });
  const book = await api<{ config: { preset?: string; tts: { provider: string; voices: Record<string, string> } } }>(
    page,
    'GET',
    `/api/projects/${made}`,
  );
  expect(book.config.preset).toBe('google');
  expect(book.config.tts).toMatchObject({ provider: 'gemini', voices: { fr: 'Aoede' } });

  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers/);
  await page.goto('project/integers?step=make');
  // the foot of the rail opens the book's settings, with an address of its own
  await page.locator('.rail-foot').getByRole('button', { name: 'Book settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Book settings' });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/project\/integers\/settings\?step=make$/);
  // edited, then Esc: the loss dialog; Stay keeps the sheet
  await sheet.getByLabel('Title in English', { exact: true }).fill('Integers, settled');
  await page.keyboard.press('Escape');
  await page.locator('dialog.dialog').getByRole('button', { name: 'Stay' }).click();
  await expect(sheet).toBeVisible();
  // the limit, then Save settings: the head and the spend chip show the new values
  await sheet.getByLabel('Spending limit', { exact: true }).fill('2.50');
  await sheet.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.locator('.toast')).toContainText('Settings saved');
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/project\/integers\?step=make$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Integers, settled');
  await expect(page.locator('.spend-chip')).toContainText('$2.50');
  // its address opens it, Maps unfolded
  await page.goto('project/integers/settings#maps');
  await expect(page.getByRole('dialog', { name: 'Book settings' })).toBeVisible();
  await expect(page.getByLabel('Country code (3 letters)')).toBeVisible();
  await page.getByRole('dialog', { name: 'Book settings' }).getByRole('button', { name: 'Close' }).click();

  // Make's Change opens AI and voices for this book; a set chosen there is the book's
  // (with a key: a model can write, so Make names it with Change)
  await api(page, 'PUT', '/api/keys', { GEMINI_API_KEY: 'test-dummy-key-0000abcd' });
  await page.goto('project/integers?step=make');
  await page.locator('.make-models').getByRole('link', { name: 'Change' }).click();
  await expect(page).toHaveURL(/\/ai\?book=integers#set$/);
  await expect(page.getByRole('radio', { name: '“Integers, settled”' })).toBeChecked();
  // with a Google key only, Gemini is the set the book uses; Private is chosen for it here
  await expect(page.locator('#set').getByRole('radio', { name: /^Gemini only/ })).toBeChecked();
  await page.locator('#set').getByRole('radio', { name: /^Private/ }).check();
  await expect(page.locator('#set .ai-saved')).toHaveClass(/is-on/);
  // the strip leads back to the book at its step
  await page.locator('.strips').getByRole('link', { name: /Integers, settled/ }).click();
  await expect(page).toHaveURL(/project\/integers\?step=make$/);
  await expect(page.locator('.make-models')).toContainText('Private');
});

for (const lang of ['en', 'ar'])
  test(`AI and voices and Book settings fit a phone (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudio(page, { fake: true, lang });
    await page.goto('ai');
    await expect(page.locator('#voices')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.goto('./');
    await page.locator('.book-card, button').first().waitFor();
    await api(page, 'POST', '/api/web/demo');
    await page.goto('project/integers/settings');
    await expect(page.locator('.book-sheet')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
