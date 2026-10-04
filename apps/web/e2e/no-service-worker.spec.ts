// Some browsers refuse service workers (e.g. some private windows). The studio still works: the lesson preview
// gets its narration as in-memory copies, and download links are saved by the page itself.
import { expect, test } from '@playwright/test';
import { jobDone, openStudio } from './helpers';

test.use({ serviceWorkers: 'block' });

test('without a service worker, the preview still plays its audio and the book still downloads', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('.web-warning-soft')).toBeVisible();
  await page.getByRole('button', { name: 'Open the example book' }).click();
  const preview = page.locator('.preview');
  await preview.locator('.wq-go').click();
  await expect(preview.locator('.wq-cover')).toBeHidden();
  // the player was given in-memory copies of the narration, and they play
  const audio = await page.evaluate(async () => {
    const data = (await (await fetch('/warqa/api/projects/integers/lessons/ch05/player?lang=en')).json()) as {
      audio: Record<string, Record<string, string>>;
    };
    const url = data.audio.en!.intro!;
    const a = new Audio(url);
    const ok = await new Promise<boolean>((done) => {
      a.oncanplaythrough = () => done(true);
      a.onerror = () => done(false);
    });
    return { url: url.slice(0, 5), ok, duration: a.duration };
  });
  expect(audio).toMatchObject({ url: 'blob:', ok: true });
  expect(audio.duration).toBeGreaterThan(1);

  await page.goto('project/integers?step=export');
  await page.getByRole('button', { name: 'Export the book' }).click();
  expect(await jobDone(page)).toContain('pill-done');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download .zip' }).click();
  expect((await download).suggestedFilename()).toBe('integers.zip');
});
