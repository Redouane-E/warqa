// The learner's states (redesign 4h): sound the browser will not play before a tap, a language with no voice yet
// (the words light up at reading speed), and saving the book on this device for offline use.
import { expect, test } from '@playwright/test';

test('sound refused before a tap: the lesson waits under "Tap to play the sound", the tap plays it', async ({
  page,
}) => {
  // the browser's autoplay rule, as a page sees it: play() refused until a gesture
  await page.addInitScript(() => {
    const real = HTMLMediaElement.prototype.play;
    const w = window as unknown as { allowSound?: boolean };
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!w.allowSound) return Promise.reject(new DOMException('play() needs a gesture', 'NotAllowedError'));
      return real.call(this);
    };
  });
  await page.goto('ch05/index.html?lang=ar');
  await page.locator('.wq-cover').click();
  const tap = page.getByRole('button', { name: 'انقر لتشغيل الصوت' });
  await expect(tap).toBeVisible();
  await expect(tap).toBeFocused();
  // the lesson holds (the narration and the picture stay together) and the picture dims
  await expect(page.locator('.wq-player')).toHaveClass(/wq-sound-blocked/);
  await expect(page.locator('.wq-player')).not.toHaveClass(/wq-playing/);
  await expect(page.locator('.wq-paused')).toBeHidden();
  await page.evaluate(() => {
    (window as unknown as { allowSound?: boolean }).allowSound = true;
  });
  await tap.click();
  await expect(tap).toBeHidden();
  await expect(page.locator('.wq-player')).toHaveClass(/wq-playing/);
  await expect(page.locator('.wq-player')).not.toHaveClass(/wq-sound-blocked/);
});

test('no voice in this language: said under the stage, the words light up at reading speed', async ({ page }) => {
  // the gallery book has no recorded narration
  await page.goto('gallery/gallery/index.html');
  const note = page.locator('.wq-novoice');
  await expect(note).toBeVisible();
  await expect(note).toContainText('No voice · follow the text');
  await expect(note).toContainText('There is no voice in English yet. The words light up at reading speed.');
  await page.locator('.wq-cover').click();
  // the captions are the narration here: shown without asking, read along word by word
  await expect(page.locator('.wq-caption')).toBeVisible();
  await expect(page.locator('.wq-caption .wq-now')).toHaveCount(1, { timeout: 10_000 });
});

test('a book with recorded narration says nothing about voices', async ({ page }) => {
  await page.goto('ch05/index.html?lang=en');
  await expect(page.locator('.wq-cover')).toBeVisible();
  await expect(page.locator('.wq-novoice')).toBeHidden();
});

test('saving the book on this device: ready offline with its size, deleted, saved again', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'service workers are checked in Chromium');
  await page.goto('index.html?lang=en');
  const panel = page.locator('.wq-bh-offline');
  await expect(panel.locator('.wq-bh-off-ready')).toContainText(/Ready offline · \u2066[\d.]+ MB\u2069/, {
    timeout: 30_000,
  });
  // said once, in a live region that the panel's redraws leave alone
  await expect(page.getByRole('status').filter({ hasText: 'Ready offline' })).toHaveCount(1);
  await panel.getByRole('button', { name: 'Delete it from this device' }).click();
  // the focus goes to the button that replaced it
  await expect(page.getByRole('button', { name: 'Save on this device for offline use' })).toBeFocused();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('warqa:')).length)).toBe(0);
  // the next visit does not save it again by itself
  await page.reload();
  await expect(page.getByRole('button', { name: 'Save on this device for offline use' })).toBeVisible();
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  // asked again: it saves
  await page.getByRole('button', { name: 'Save on this device for offline use' }).click();
  await expect(panel.locator('.wq-bh-off-ready')).toContainText('Ready offline', { timeout: 30_000 });
});
