// Read-along, Darija, region maps with a pick question, typeset math, component gallery and the teacher panel,
// in Chromium, Firefox and WebKit.
import { expect, type Page, test } from '@playwright/test';

type W = {
  warqa: {
    freeze(beat: number, t: number): void;
    begin(): void;
    seek(i: number, play: boolean): void;
    setCaptions(on: boolean): void;
    compiled: { beats: { id: string; end: number }[] };
  };
};

async function ready(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Partial<W>).warqa);
}
const beatIndex = (page: Page, id: string) =>
  page.evaluate((b) => (window as unknown as W).warqa.compiled.beats.findIndex((x) => x.id === b), id);
const freeze = (page: Page, beat: number, t: number) =>
  page.evaluate(([b, s]) => (window as unknown as W).warqa.freeze(b!, s!), [beat, t]);

test.describe('read-along', () => {
  test('highlights the word being read, in the page and in the captions', async ({ page }) => {
    await page.goto('fox/story/index.html?lang=ar');
    await ready(page);
    const p4 = await beatIndex(page, 'p4');
    await page.evaluate(() => (window as unknown as W).warqa.setCaptions(true));
    await freeze(page, p4, 8.95);
    await expect(page.locator('.wq-story-text .wq-now')).toHaveText('نقرأ');
    await expect(page.locator('.wq-caption .wq-now')).toHaveText('نقرأ');
    // later, another word
    await freeze(page, p4, 13.3);
    await expect(page.locator('.wq-story-text .wq-now')).toHaveText('صديقة');
  });

  test('plays in Darija with a Darija interface', async ({ page }) => {
    await page.goto('fox/story/index.html?lang=ary');
    await ready(page);
    await expect(page.locator('.wq-player')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.wq-cover')).toContainText('بدا الدرس');
    await expect(page.locator('.wq-cover')).toContainText('زيتون والورقة اللي طارت');
  });
});

test.describe('maps', () => {
  test('draws Morocco’s regions with labels and the data credit', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('morocco/regions/index.html?lang=fr');
    await ready(page);
    const twelve = await beatIndex(page, 'twelve');
    await freeze(page, twelve, 30);
    // the region layer loaded (a script file next to the book) and four regions are highlighted with labels
    await expect.poll(() => page.evaluate(() => Object.keys(window.WARQA_GEO_LAYERS ?? {}))).toEqual(['MAR-ADM1']);
    await expect(page.locator('.wq-node[data-id="m2"] text', { hasText: 'Souss-Massa' })).toHaveCount(1);
    await expect(page.locator('.wq-node[data-id="m2"] text', { hasText: 'OpenStreetMap' })).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('asks to pick a region on the map', async ({ page }) => {
    await page.goto('morocco/regions/index.html?lang=fr');
    await ready(page);
    const q = await beatIndex(page, 'q1');
    await page.evaluate((i) => {
      const w = (window as unknown as W).warqa;
      w.begin();
      w.seek(i, true); // the question opens when the narration ends
    }, q);
    await expect(page.locator('.wq-pick')).toHaveCount(4, { timeout: 20_000 });
    await page.locator('.wq-pick[data-s="r:2"]').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.wq-card .wq-fb')).toContainText(/Agadir/);
  });
});

test.describe('gallery', () => {
  test('every component renders without errors; math is typeset', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('gallery/gallery/index.html');
    await ready(page);
    const n = await page.evaluate(() => (window as unknown as W).warqa.compiled.beats.length);
    const endOf = (i: number) => page.evaluate((k) => (window as unknown as W).warqa.compiled.beats[k]!.end - 0.1, i);
    for (let i = 0; i < n; i++) await freeze(page, i, await endOf(i));
    const m = await beatIndex(page, 'g-math3');
    await freeze(page, m, await endOf(m));
    // the second step (the quadratic formula) is showing
    const svg = page.locator('.wq-c-math .wq-math-step').nth(1).locator('svg');
    await expect(svg).toBeVisible();
    expect(await svg.locator('path').count()).toBeGreaterThan(5);
    await expect(page.locator('.wq-math-plain')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('teacher panel', () => {
  test('rates a step and keeps the rating', async ({ page }) => {
    await page.goto('ch05/index.html?lang=en&panel');
    await ready(page);
    await freeze(page, 1, 3);
    await page.keyboard.press('KeyR');
    const dialog = page.locator('dialog.wq-panel');
    await expect(dialog).toBeVisible();
    await dialog.locator('input[name="wq-clarity"][value="4"]').check({ force: true });
    await dialog.locator('input[name="wq-use"][value="yes"]').check({ force: true });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const saved = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('warqa:panel:'))!;
      return JSON.parse(localStorage.getItem(k)!);
    });
    const lesson = saved.lessons.ch05;
    expect(Object.values(lesson.beats)).toEqual([{ clarity: 4 }]);
    expect(lesson.overall.use).toBe('yes');
  });
});

test.describe('component packs', () => {
  test('a pack component draws, animates and can be picked', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('clock/time/index.html');
    await ready(page);
    const endOf = (i: number) => page.evaluate((k) => (window as unknown as W).warqa.compiled.beats[k]!.end - 0.1, i);
    await freeze(page, 0, await endOf(0));
    await expect(page.locator('.wq-node[data-id="c"] text', { hasText: '4:30' })).toHaveCount(1);
    await page.reload();
    await ready(page);
    await page.evaluate(() => {
      const w = (window as unknown as W).warqa;
      w.begin();
      w.seek(1, true);
    });
    await expect(page.locator('.wq-pick')).toHaveCount(2, { timeout: 20_000 });
    await page.locator('.wq-pick[data-s="hour"]').click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.wq-card .wq-fb')).toContainText(/short hand/);
    expect(errors).toEqual([]);
  });
});
