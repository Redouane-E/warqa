// The player on a phone (redesign phase 5), in Chromium, Firefox and WebKit at 390 × 844 with touch: Listening,
// the transcript's two heights, tap to pause, swipe to turn the page (mirrored in Arabic), press and hold a word,
// the question under the picture, the finish; then the keys on a desktop.
import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

type P = {
  warqa: {
    i: number;
    playing: boolean;
    rate: number;
    lang: string;
    begin(): void;
    pause(): void;
    play(): void;
    seek(i: number, play: boolean): void;
    compiled: { beats: { beat: { questions?: unknown[] } }[] };
  };
};
const player = <T>(page: Page, f: (p: P['warqa']) => T) =>
  page.evaluate(`(${f.toString()})(window.warqa)`) as Promise<T>;

async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => !!(window as unknown as Partial<P>).warqa);
  await page.locator('.wq-cover').click();
  await expect.poll(() => player(page, (p) => p.playing)).toBe(true);
}

/**
 * A finger on a surface: down, (a move,) up — Pointer Events as a phone sends them. A tap or a swipe is sent in one
 * call to the page: one round trip per event could outlast a swipe (600 ms) or turn a tap into a hold on a busy
 * machine. A hold waits between the press and the release.
 */
async function finger(target: Locator, dx: number, dy: number, hold = 0) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const fire = (types: string[]) =>
    target.evaluate(
      (el, a) => {
        for (const type of a.types) {
          const k = type === 'pointerdown' ? 0 : 1;
          const at = { clientX: a.x + a.dx * k, clientY: a.y + a.dy * k };
          el.dispatchEvent(
            new PointerEvent(type, { pointerType: 'touch', pointerId: 7, isPrimary: true, bubbles: true, ...at }),
          );
        }
      },
      { types, x, y, dx, dy },
    );
  const press = dx || dy ? ['pointerdown', 'pointermove'] : ['pointerdown'];
  if (!hold) return fire([...press, 'pointerup']);
  await fire(press);
  await target.page().waitForTimeout(hold);
  await fire(['pointerup']);
}

const noSideways = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.scrollingElement!.scrollWidth)).toBeLessThanOrEqual(390);

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Listening: language, speed, read-along and look in one sheet', async ({ page }) => {
    await open(page, 'ch05/index.html?lang=en');
    await player(page, (p) => p.seek(2, false));
    const btn = page.getByRole('button', { name: 'Listening' });
    await btn.click();
    const sheet = page.getByRole('dialog', { name: 'Listening' });
    await expect(sheet).toBeVisible();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    // the language changes at once and keeps the place; the sheet stays open, now in French
    await sheet.getByRole('radio', { name: 'Français' }).click();
    await expect.poll(() => player(page, (p) => p.lang)).toBe('fr');
    expect(await player(page, (p) => p.i)).toBe(2);
    const fr = page.getByRole('dialog', { name: 'Écoute' });
    await expect(fr.getByRole('radio', { name: 'Français' })).toBeFocused();
    // speed, remembered
    await fr.getByRole('radio', { name: '1,25×' }).click();
    expect(await player(page, (p) => p.rate)).toBe(1.25);
    expect(await page.evaluate(() => localStorage.getItem('warqa:speed'))).toBe('1.25');
    // the read-along is the captions setting (the C key's)
    const sw = fr.getByRole('switch', { name: 'Surligner le mot dit' });
    const was = await sw.getAttribute('aria-checked');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
    await expect(page.locator('.wq-caption')).toBeVisible({ visible: was !== 'true' });
    // the look
    await fr.getByRole('radio', { name: 'Tableau' }).click();
    await expect(page.locator('.wq-player')).toHaveClass(/wq-theme-board/);
    // Esc closes, the focus goes back to its button
    await page.keyboard.press('Escape');
    await expect(fr).toBeHidden();
    await expect(page.getByRole('button', { name: 'Écoute' })).toBeFocused();
    // the veil closes it too
    await page.getByRole('button', { name: 'Écoute' }).click();
    await page.locator('.wq-veil').click({ position: { x: 20, y: 20 } });
    await expect(fr).toBeHidden();
    await noSideways(page);
  });

  test('in Arabic: right to left, nothing scrolls sideways, no serious axe violations with a sheet open', async ({
    page,
  }) => {
    await open(page, 'ch05/index.html?lang=ar');
    await expect(page.locator('.wq-player')).toHaveAttribute('dir', 'rtl');
    await noSideways(page);
    await page.getByRole('button', { name: 'الاستماع' }).click();
    await expect(page.getByRole('dialog', { name: 'الاستماع' })).toBeVisible();
    await noSideways(page);
    const r = await new AxeBuilder({ page }).include('.wq-listen').disableRules(['region']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });

  test('the transcript: half height, then full; dragged down it closes; a step in it is a way there', async ({
    page,
  }) => {
    await open(page, 'ch05/index.html?lang=en');
    await page.locator('.wq-bottomrow .wq-txt-bar').click();
    const tr = page.locator('.wq-transcript');
    await expect(tr).toBeVisible();
    // the lesson plays on above it: about half the screen
    await expect.poll(async () => (await tr.boundingBox())!.height).toBeGreaterThan(400);
    expect((await tr.boundingBox())!.height).toBeLessThan(460);
    const size = tr.getByRole('button', { name: 'Expand' });
    await size.click();
    await expect(tr.getByRole('button', { name: 'Collapse' })).toBeVisible();
    await expect.poll(async () => (await tr.boundingBox())!.height).toBeGreaterThan(740);
    await tr.getByRole('button', { name: 'Collapse' }).click();
    await expect.poll(async () => (await tr.boundingBox())!.height).toBeLessThan(460);
    // a step in it
    await tr.locator('li[data-i="3"] .wq-tr-beat').click();
    await expect.poll(() => player(page, (p) => p.i)).toBe(3);
    // the handle dragged down closes it
    await finger(tr.locator('.wq-grip'), 0, 380);
    await expect(tr).toBeHidden();
  });

  test('a tap on the picture pauses and plays; paused says so at a size a finger can read', async ({ page }) => {
    await open(page, 'ch05/index.html?lang=en');
    const stage = page.locator('.wq-viewport');
    // a real tap: the browser follows it with a click, which must not undo it
    await stage.tap();
    await expect.poll(() => player(page, (p) => p.playing)).toBe(false);
    await page.waitForTimeout(300);
    expect(await player(page, (p) => p.playing)).toBe(false);
    const paused = page.locator('.wq-paused');
    await expect(paused).toBeVisible();
    await expect(paused).toContainText('Paused · tap to continue');
    expect((await paused.locator('.wq-paused-btn').boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await stage.tap();
    await expect.poll(() => player(page, (p) => p.playing)).toBe(true);
  });

  test('keys pressed in Listening stay there; Home and End move within a group', async ({ page }) => {
    await open(page, 'ch05/index.html?lang=en');
    await player(page, (p) => p.seek(2, false));
    await page.getByRole('button', { name: 'Listening' }).click();
    const sheet = page.getByRole('dialog', { name: 'Listening' });
    await sheet.getByRole('switch').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Home');
    expect(await player(page, (p) => p.i)).toBe(2);
    await sheet.getByRole('radio', { name: '1×' }).focus();
    await page.keyboard.press('End');
    await expect(sheet.getByRole('radio', { name: '1.5×' })).toBeFocused();
    // a tap on its text keeps the focus inside: Esc still closes it
    await sheet.locator('.wq-ls-hint').click();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('a swipe turns the page: to the left in English, to the right in Arabic', async ({ page }) => {
    await open(page, 'ch05/index.html?lang=en');
    const stage = page.locator('.wq-viewport');
    await finger(stage, -120, 6);
    await expect.poll(() => player(page, (p) => p.i)).toBe(1);
    // too short, or up and down: nothing
    await finger(stage, -20, 0);
    await finger(stage, 30, 140);
    expect(await player(page, (p) => p.i)).toBe(1);
    await finger(stage, 120, 0);
    await expect.poll(() => player(page, (p) => p.i)).toBe(0);
    await open(page, 'ch05/index.html?lang=ar');
    await finger(page.locator('.wq-viewport'), 120, 0);
    await expect.poll(() => player(page, (p) => p.i)).toBe(1);
  });

  test('press and hold a word: the lesson pauses and the word is said again on its own', async ({ page }) => {
    // every sound that starts, with where it starts
    await page.addInitScript(() => {
      const w = window as unknown as { heard: number[] };
      w.heard = [];
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        w.heard.push(this.currentTime);
        return Promise.resolve();
      };
    });
    await open(page, 'fox/story/index.html?lang=ar');
    await page.evaluate(() => {
      (window as unknown as { warqa: { setCaptions(on: boolean): void } }).warqa.setCaptions(true);
    });
    await expect(page.locator('.wq-caption .wq-w').first()).toBeVisible({ timeout: 15_000 });
    const word = page.locator('.wq-caption .wq-w').nth(1);
    const text = (await word.textContent())!.trim();
    const before = await page.evaluate(() => (window as unknown as { heard: number[] }).heard.length);
    await finger(word, 0, 0, 650);
    await expect.poll(() => player(page, (p) => p.playing)).toBe(false);
    await expect(page.locator('.wq-wordpill')).toContainText(text);
    const heard = await page.evaluate(() => (window as unknown as { heard: number[] }).heard);
    // a second sound, started at that word (not at the beat's start)
    expect(heard.length).toBeGreaterThan(before);
    expect(heard.at(-1)).toBeGreaterThan(0);
  });

  test('a question waits under the picture: the bar says so; Check, then Continue', async ({ page }) => {
    await open(page, 'ch05/index.html?lang=en');
    const q = await player(page, (p) => p.compiled.beats.findIndex((b) => !!b.beat.questions?.length));
    await player(page, (p) => p.pause());
    await page.evaluate((i) => {
      const p = (window as unknown as P).warqa;
      p.seek(i, false);
      (p as unknown as { time: number }).time = 999;
      (p as unknown as { maybeAsk(): void }).maybeAsk();
    }, q);
    const card = page.locator('.wq-cards-out .wq-card');
    await expect(card).toBeVisible();
    await expect(page.locator('.wq-wait')).toContainText('Waiting for your answer');
    await expect(page.locator('.wq-play')).toBeHidden();
    // the answer by taps
    await card.locator('.wq-choice').first().tap();
    await card.getByRole('button', { name: 'Check' }).tap();
    await expect(card.getByRole('button', { name: /Continue|Next/ })).toBeVisible();
    await noSideways(page);
  });
});

test.describe('a still picture', () => {
  test("a click on the editor's bare stage neither plays nor turns the page", async ({ page }) => {
    await page.goto('ch05/index.html?lang=en');
    await page.waitForFunction(() => !!(window as unknown as Partial<P>).warqa);
    await page.evaluate(() => {
      const p = (window as unknown as { warqa: { setBare(on: boolean): void; showAt(i: number): void } }).warqa;
      p.setBare(true);
      p.showAt(1);
    });
    await page.locator('.wq-viewport').click();
    await page.waitForTimeout(600);
    expect(await player(page, (p) => p.playing)).toBe(false);
    expect(await player(page, (p) => p.i)).toBe(1);
  });
});

test.describe('keys on a desktop', () => {
  test('< and > change the speed; ? pauses and lists the keys, with a Close button', async ({ page }) => {
    await open(page, 'ch05/index.html?lang=en');
    await page.keyboard.press('Shift+Period');
    await expect.poll(() => player(page, (p) => p.rate)).toBe(1.25);
    await page.keyboard.press('Shift+Comma');
    await page.keyboard.press('Shift+Comma');
    await expect.poll(() => player(page, (p) => p.rate)).toBe(0.75);
    await page.keyboard.press('Shift+Slash');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Slower or faster');
    expect(await player(page, (p) => p.playing)).toBe(false);
    await help.getByRole('button', { name: 'Close' }).click();
    await expect(help).toBeHidden();
  });

  test('in Arabic the letter keys show their Arabic letters', async ({ page }) => {
    await open(page, 'ch05/index.html?lang=ar');
    await page.keyboard.press('Shift+Slash');
    await expect(page.locator('.wq-help kbd', { hasText: /^C/ })).toHaveText('Cؤ');
  });
});
