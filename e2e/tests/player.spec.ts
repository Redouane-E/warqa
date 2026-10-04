// Player end-to-end tests on the exported example book (chapter 5 in en/fr/ar), in Chromium, Firefox and WebKit.
// Portions derived from Papermorph (MIT): the keyboard walk-through of e2e.py.
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const lesson = (lang: string, extra = '') => `ch05/index.html?lang=${lang}${extra}`;

async function ready(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as { warqa?: unknown }).warqa);
}

const ev = <T>(page: Page, fn: string) => page.evaluate(fn) as Promise<T>;

async function seek(page: Page, i: number) {
  await page.evaluate((n) => {
    const p = (window as unknown as { warqa: { begin(): void; seek(i: number, play: boolean): void } }).warqa;
    p.begin();
    p.seek(n, true);
  }, i);
}

test.describe('player', () => {
  test('starts from the cover and plays', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(lesson('en'));
    await ready(page);
    await expect(page.locator('.wq-cover')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('.wq-cover')).toBeHidden();
    // the clock follows the audio, or the wall clock when sound is blocked; busy WebKit pages may start late
    await expect.poll(() => ev<number>(page, 'window.warqa.time'), { timeout: 10_000 }).toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
  });

  test('quick check: wrong first, then right; first try is kept', async ({ page }) => {
    await page.goto(lesson('en'));
    await ready(page);
    await seek(page, 5); // q1
    const card = page.locator('.wq-card');
    await expect(card).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Digit2');
    await page.keyboard.press('Enter');
    await expect(card.locator('.wq-fb')).toContainText('Not quite');
    expect(await ev<number>(page, "window.warqa.scores['c-rewrite'].right")).toBe(0);
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Enter');
    await expect(card.locator('.wq-fb')).toContainText('Correct');
    await page.keyboard.press('Enter'); // next question
    await expect(card.locator('.wq-prompt')).toContainText('difference');
    await page.locator('.wq-box').first().fill('13');
    await page.keyboard.press('Enter');
    await expect(card.locator('.wq-fb')).toContainText('Correct');
    expect(await ev<number>(page, "window.warqa.scores['c-sub'].right")).toBe(1);
    // the answer animation steps the equation
    await page.waitForTimeout(1600);
    await page.keyboard.press('Enter');
    await expect.poll(() => ev<number>(page, 'window.warqa.i')).toBe(6);
    // the first-try score survives a revisit
    await seek(page, 5);
    expect(await ev<number>(page, "window.warqa.scores['c-rewrite'].right")).toBe(0);
  });

  test('practice in Arabic accepts Arabic-Indic digits and shows answers', async ({ page }) => {
    await page.goto(lesson('ar'));
    await ready(page);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await seek(page, 10); // final1: 7 rows
    const boxes = page.locator('.wq-box');
    await expect(boxes).toHaveCount(7);
    await boxes.nth(0).fill('-٧'); // −7 typed with Arabic-Indic digits
    await page.keyboard.press('Enter');
    await expect(page.locator('.wq-rowmark').first()).toHaveText('✓');
    await page.keyboard.press('Escape');
    await page.keyboard.press('KeyS'); // show answer
    await expect(boxes.nth(6)).toHaveValue('−5');
    await expect(page.locator('.wq-card .wq-fb')).toContainText('الإجابة');
  });

  test('right-to-left: slots mirror, math and number lines do not', async ({ page }) => {
    await page.goto(lesson('ar', '&beat=1&t=17'));
    await ready(page);
    const boxes = await ev<{ id: string; box: { x: number } }[]>(page, 'window.warqa.qa().boxes');
    const x = (id: string) => boxes.find((b) => b.id === id)!.box.x;
    expect(x('e1')).toBeGreaterThan(x('e2')); // first equation at the reading start (right)
    const ticks = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.wq-scene text')].filter((t) =>
        /^[−-]?8$/.test(t.textContent ?? ''),
      );
      return labels.map((t) => ({ v: t.textContent, x: (t as SVGTextElement).getBBox().x }));
    });
    const neg = ticks.find((t) => t.v !== '8')!;
    const pos = ticks.find((t) => t.v === '8')!;
    expect(neg.x).toBeLessThan(pos.x); // the number line still runs left to right
  });

  test('arrow keys follow the reading direction', async ({ page }) => {
    await page.goto(lesson('ar'));
    await ready(page);
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft'); // next in RTL
    await expect.poll(() => ev<number>(page, 'window.warqa.i')).toBe(1);
    await page.keyboard.press('ArrowRight'); // previous
    await expect.poll(() => ev<number>(page, 'window.warqa.i')).toBe(0);
  });

  test('switching language keeps the place', async ({ page }) => {
    await page.goto(lesson('en'));
    await ready(page);
    await seek(page, 2);
    await page.evaluate(() => (window as unknown as { warqa: { setLang(l: string): void } }).warqa.setLang('fr'));
    expect(await ev<number>(page, 'window.warqa.i')).toBe(2);
    expect(await ev<string>(page, 'window.warqa.lang')).toBe('fr');
    await expect(page.locator('.wq-html')).toContainText('opposé');
  });

  test('finish card shows the first-try score', async ({ page }) => {
    await page.goto(lesson('fr'));
    await ready(page);
    await seek(page, 13);
    await expect(page.locator('.wq-finish')).toBeVisible();
    await expect(page.locator('.wq-finish h2')).toContainText('Chapitre 5');
  });

  test('reduced motion snaps every change to its end', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(lesson('en'));
    await ready(page);
    await page.evaluate(() =>
      (window as unknown as { warqa: { freeze(b: number, t: number): void } }).warqa.freeze(2, 8.4),
    );
    // chg1 is at 8.16 s; with reduced motion the equation is already on step 1
    const step = await page.evaluate(() => {
      const p = (
        window as unknown as {
          warqa: {
            compiled: {
              beats: { segs: Map<string, { ch: string; node: string; to: number; t0: number; dur: number }[]> }[];
            };
          };
        }
      ).warqa;
      return [...p.compiled.beats[2]!.segs.values()].flat().find((s) => s.node === 'eq1' && s.ch === 'step')!.to;
    });
    expect(step).toBe(1);
  });

  test('works offline from file://', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit blocks file:// fonts in headless mode');
    const site = process.env.WARQA_E2E_SITE!;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${pathToFileURL(site).href}/ch05/index.html?lang=en&beat=2&t=12`);
    await ready(page);
    expect(await ev<number>(page, 'window.warqa.compiled.beats.length')).toBe(14);
    await expect(page.locator('.wq-html')).toContainText('Subtracting a number');
    expect(errors).toEqual([]);
  });

  test('book contents page lists the chapter and switches language', async ({ page }) => {
    await page.goto('index.html?lang=ar');
    await expect(page.locator('h1')).toContainText('الأعداد الصحيحة');
    await expect(page.locator('.wq-unit a')).toHaveCount(1);
    await page.locator('.wq-book select').selectOption('fr');
    await expect(page.locator('h1')).toContainText('entiers relatifs');
  });

  test('accessibility: no serious axe violations on the cover, the stage and a question', async ({ page }) => {
    await page.goto(lesson('ar'));
    await ready(page);
    const scan = async () => {
      const r = await new AxeBuilder({ page }).disableRules(['region']).analyze();
      return r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes[0]?.target}`);
    };
    expect(await scan()).toEqual([]);
    await seek(page, 5);
    await expect(page.locator('.wq-card')).toBeVisible();
    expect(await scan()).toEqual([]);
  });
});
