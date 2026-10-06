// The Check step in the browser (redesign 4f): checks draw each beat in a hidden browser, which a web page cannot
// start, so the step says so and points to the desktop version; a book whose checks were made on the desktop (here
// imported from a backup holding a saved check and the judge's verdict) shows its contact sheet, the judge's scores in
// red pen, and the beat chosen; the review kit works in the browser. Nothing spends.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { beatHashes, Project } from '@warqa/pipeline';
import { strToU8, zipSync } from 'fflate';
import { openStudio } from './helpers';

const example = resolve(import.meta.dirname, '../../../examples/integers.warqa');

/** The example book as a backup, with a saved check of ch05 in English and the judge's verdict. */
function checkedBackup(): Buffer {
  const files: Record<string, Uint8Array> = {};
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      const rel = relative(example, p).replace(/\\/g, '/');
      if (/^(dist|cache|qa)(\/|$)/.test(rel)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else files[`integers.warqa/${rel}`] = new Uint8Array(readFileSync(p));
    }
  };
  walk(example);
  const lesson = JSON.parse(readFileSync(join(example, 'lessons', 'ch05', 'lesson.json'), 'utf8')) as {
    beats: { id: string; move: string; questions?: unknown[]; scene?: { add?: { id: string }[] } }[];
  };
  const scored = lesson.beats.filter((b) => !b.questions?.length && b.move !== 'finish');
  // a tiny picture for every beat (a 1×1 JPEG)
  const jpg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  );
  lesson.beats.forEach((_, i) => {
    files[`integers.warqa/qa/ch05/en/b${String(i).padStart(2, '0')}_end.jpg`] = new Uint8Array(jpg);
  });
  const parts = lesson.beats.flatMap((b) => (b.scene?.add ?? []).map((n) => n.id));
  // the check was made of the lesson as it is (so Improve can start from the judge's verdict)
  const hashes = beatHashes(new Project(example), 'ch05', 'en');
  files['integers.warqa/qa/ch05/en-check.json'] = strToU8(
    JSON.stringify({
      schema: 'warqa.check/1',
      at: Date.now(),
      lang: 'en',
      beats: lesson.beats.map((b, i) => ({
        id: b.id,
        index: i,
        dur: 10,
        hash: hashes[b.id] ?? '',
        thumb: `b${String(i).padStart(2, '0')}_end.jpg`,
      })),
      issues: [
        {
          beat: 2,
          id: lesson.beats[2]!.id,
          kind: 'overlap',
          message: 'overlap',
          nodes: parts.slice(0, 2),
          box: { x: 400, y: 300, w: 200, h: 80 },
        },
      ],
      judged: true,
    }),
  );
  files['integers.warqa/qa/ch05/en-judge.json'] = strToU8(
    JSON.stringify(
      scored.map((b, i) =>
        i === 1
          ? { id: b.id, score: 2, problem: 'The labels are too small.', fix: 'Make the labels bigger.' }
          : { id: b.id, score: 5 },
      ),
    ),
  );
  // an exported site in the backup is not imported: the browser serves only the site it exports itself
  files['integers.warqa/dist/index.html'] = strToU8('<!doctype html><title>NOT-THIS-STUDIO</title>');
  return Buffer.from(zipSync(files, { level: 1 }));
}

async function importChecked(page: Page) {
  await page.getByTestId('import-input').setInputFiles({
    name: 'integers.warqa.zip',
    mimeType: 'application/zip',
    buffer: checkedBackup(),
  });
  await expect(page).toHaveURL(/\/warqa\/project\/integers$/);
  const served = await page.evaluate(async () => (await fetch('/warqa/books/integers/')).text());
  expect(served).not.toContain('NOT-THIS-STUDIO');
}

test('checks need the desktop version, and say so', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Open the example book' }).click();
  await expect(page).toHaveURL(/project\/integers/);
  await page.goto('project/integers?step=check');
  await expect(page.getByRole('heading', { level: 2, name: /^Check/ })).toBeVisible();
  const run = page.getByRole('button', { name: 'Run the checks' });
  await expect(run).toBeDisabled();
  await expect(run).toHaveAccessibleDescription(/hidden browser, which a web page can't start/);
  await expect(page.getByText('Desktop version only').first()).toBeVisible();
});

test('a checked chapter: the contact sheet, the judge in red pen, the beat chosen, and a review kit', async ({
  page,
}) => {
  await openStudio(page);
  await importChecked(page);
  await page.goto('project/integers?step=check&chapter=ch05&lang=en');
  const sheet = page.getByRole('list', { name: /^Beats of chapter/ });
  await expect(sheet.getByRole('listitem')).toHaveCount(14);
  await expect(page.locator('.check-summary')).toContainText('2 need attention');
  // the beat the judge scored 2: its tile says it, and it opens below with its note and the fix to ask for
  const weak = sheet.getByRole('link', { name: /score 2, needs attention/ });
  await weak.click();
  await expect(weak).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('img', { name: 'Score 2 out of 5' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What should change in this beat?' })).toHaveValue(
    'Make the labels bigger.',
  );
  await expect(page).toHaveURL(/beat=2/);
  // the beat with a finding: what it is, in words
  await sheet.getByRole('link', { name: /Labels overlap/ }).click();
  await expect(page.locator('.finding')).toContainText('share the same spot at the end of the beat');
  // Improve lists what it would rewrite; it needs the desktop version here
  await expect(page.locator('.improve-list li')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Improve 1 beat' })).toBeDisabled();
  // Ask teachers: the review kit is made in the browser too
  await page.getByRole('button', { name: 'Export a review kit' }).click();
  const toast = page.locator('.toast').filter({ hasText: 'Review kit ready' });
  await expect(toast).toBeVisible({ timeout: 60_000 });
  const download = page.waitForEvent('download');
  await toast.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('integers-review-kit.zip');
});

test('the contact sheet reads right to left in Arabic', async ({ page }) => {
  await openStudio(page, { lang: 'ar' });
  await importChecked(page);
  await page.goto('project/integers?step=check&chapter=ch05&lang=en');
  const tiles = page.locator('.beat-tile');
  await expect(tiles).toHaveCount(14);
  const [a, b] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()];
  expect(a!.x).toBeGreaterThan(b!.x);
  await expect(page.locator('.beat-tile .pen-score').first()).toHaveAttribute('dir', 'ltr');
});
