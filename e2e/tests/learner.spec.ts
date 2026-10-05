// The finish card of someone learning on their own (the studio passes `learner` to mount()), on the exported
// chapter 5; exported books themselves keep the plain finish card.
import { expect, type Page, test } from '@playwright/test';

interface P {
  i: number;
  scores: Record<string, { right: number; total: number; kind: string }>;
  compiled: { beats: { askAt: number }[] };
  freeze(beat: number, t: number): void;
  destroy(): void;
  learnerNext(state: { status: string; pct?: number; open?: () => void }): void;
}
type W = {
  warqa: P;
  WARQA_DATA: Record<string, unknown>;
  Warqa: { mount(el: HTMLElement, data: unknown, opts: unknown): Promise<P> };
  calls: string[];
};

/** Mount chapter 5 for a learner, with one quick check missed, and jump to its finish card. */
async function learnerAtEnd(page: Page, lang: string) {
  await page.goto(`ch05/index.html?lang=${lang}`);
  await page.waitForFunction(() => !!(window as unknown as { warqa?: unknown }).warqa);
  await page.evaluate(async (lang) => {
    const w = window as unknown as W;
    w.warqa.destroy();
    w.calls = [];
    const p = await w.Warqa.mount(
      document.getElementById('warqa')!,
      { ...w.WARQA_DATA, lang },
      {
        storage: false,
        learner: {
          level: 'I know some',
          onFeedback: (f: string) => {
            w.calls.push(f);
            return Promise.resolve('Advanced');
          },
          next: { n: 6, title: 'Multiplying', cost: '$0.04', run: () => w.calls.push('run') },
          home: () => w.calls.push('home'),
        },
      },
    );
    w.warqa = p;
    p.scores = {
      'c-rewrite': { right: 0, total: 1, kind: 'check' },
      'c-sub': { right: 1, total: 1, kind: 'check' },
    };
    const last = p.compiled.beats.length - 1;
    p.freeze(last, p.compiled.beats[last]!.askAt + 0.01);
  }, lang);
}

test.describe('learner finish card', () => {
  test('asks how it was, makes the next chapter, reviews what was missed', async ({ page }) => {
    await learnerAtEnd(page, 'en');
    const card = page.locator('.wq-finish-learn');
    await expect(card.locator('.wq-fin-num')).toHaveText('1 / 2');
    // the card's title has the focus, never the costed button: the keys pressed as the lesson ends spend nothing
    await expect(card.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(card.locator('.wq-nextch-go')).toHaveText('Make chapter 6 · about $0.04');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as unknown as W).calls)).toEqual([]);
    const easy = card.getByRole('button', { name: 'Too easy' });
    await easy.click();
    await expect(easy).toHaveAttribute('aria-pressed', 'true');
    await expect(card.locator('.wq-feel-foot')).toContainText('Your level now: Advanced');
    await card.locator('.wq-nextch-go').click();
    await page.evaluate(() => (window as unknown as W).warqa.learnerNext({ status: 'making', pct: 40 }));
    await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    await page.evaluate(() => {
      const w = window as unknown as W;
      w.warqa.learnerNext({ status: 'ready', open: () => w.calls.push('open') });
    });
    await card.getByRole('button', { name: 'Open' }).click();
    expect(await page.evaluate(() => (window as unknown as W).calls)).toEqual(['too-easy', 'run', 'open']);
    await card.getByRole('button', { name: /Review what you missed \(1\)/ }).click();
    expect(await page.evaluate(() => (window as unknown as W).warqa.i)).toBe(5);
  });

  test('reads right to left in Arabic; exported books keep the plain card', async ({ page }) => {
    await learnerAtEnd(page, 'ar');
    const card = page.locator('.wq-finish-learn');
    await expect(card.locator('.wq-fin-num')).toHaveText('1 من 2');
    await expect(card.locator('.wq-review')).toContainText('راجع ما فاتك (1)');
    await expect(card.locator('.wq-nextch-hint')).toHaveText('يكون جاهزًا بعد دقيقتين تقريبًا. لن يُصرف شيء قبل أن تضغط.');
    await page.goto('ch05/index.html?lang=ar');
    await page.waitForFunction(() => !!(window as unknown as { warqa?: unknown }).warqa);
    await page.evaluate(() => {
      const p = (window as unknown as W).warqa;
      const last = p.compiled.beats.length - 1;
      p.freeze(last, p.compiled.beats[last]!.askAt + 0.01);
    });
    await expect(page.locator('.wq-finish')).toBeVisible();
    await expect(page.locator('.wq-feel, .wq-nextch, .wq-review')).toHaveCount(0);
  });
});
