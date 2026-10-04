// Automated delivery checks on a rendered lesson (headless browser): opening blanks, overlaps, content scaled
// down to fit, off-stage nodes, page errors; plus screenshots and contact sheets for a model or a person to review.
// Portions derived from Papermorph (MIT): the delivery pass (shot.py, check_blank.py, review.md).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface QaIssue {
  beat: number;
  id: string;
  kind: 'blank' | 'overlap' | 'overflow' | 'offstage' | 'error' | 'compile';
  message: string;
}

export interface QaOptions {
  /** Lesson page URL (index.html of a lesson). */
  url: string;
  lang?: string;
  /** Seconds a lesson beat may stay empty after its start (default 1). */
  blankLimit?: number;
  /** Write screenshots and contact sheets here. */
  shots?: string;
  /** Moments per beat to screenshot: "open" (1.2 s), "mid", "end". */
  moments?: ('open' | 'mid' | 'end')[];
  browser?: 'chromium' | 'firefox' | 'webkit';
  viewport?: { width: number; height: number };
}

export interface QaResult {
  issues: QaIssue[];
  beats: number;
  shots: string[];
  sheets: string[];
}

type PW = typeof import('playwright');

export async function loadPlaywright(): Promise<PW> {
  try {
    return await import('playwright');
  } catch {
    throw new Error('QA needs Playwright: `pnpm add playwright` and `npx playwright install chromium`');
  }
}

const PROBE = `(i) => {
  const p = window.warqa;
  p.freeze(i, 0);
  const cb = p.compiled.beats[i];
  const visibleCount = () => {
    let n = 0;
    const els = document.querySelectorAll('.wq-scene text, .wq-scene path, .wq-scene circle, .wq-scene rect:not(.wq-ring), .wq-html .wq-c *, .wq-html iframe, .wq-html img');
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width < 2 && r.height < 2) continue;
      let o = 1, x = e;
      while (x && x !== document.body) {
        const cs = getComputedStyle(x);
        if (cs.visibility === 'hidden' || cs.display === 'none') { o = 0; break; }
        const a = x.getAttribute && x.getAttribute('opacity');
        o *= a !== null && a !== undefined ? +a : +cs.opacity;
        x = x.parentElement || x.parentNode;
        if (o < 0.05) break;
      }
      if (o >= 0.05) n++;
    }
    return n;
  };
  const out = [];
  const first = (cb.timing.captions[0] || [0])[0];
  for (let t = 0; t <= Math.min(cb.timing.dur, 8); t += 0.2) { p.freeze(i, t); out.push([+t.toFixed(1), visibleCount()]); }
  p.freeze(i, cb.ask ? cb.timing.dur : cb.end - 0.05);
  const qa = p.qa();
  return { id: cb.id, ask: cb.ask, move: cb.beat.move, first, dur: cb.timing.dur, end: cb.end, out, boxes: qa.boxes, overflows: qa.overflows, issues: cb.issues };
}`;

const overlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
};

/** Run the delivery checks (and optionally screenshots) on a lesson page. */
export async function checkLesson(opts: QaOptions): Promise<QaResult> {
  const pw = await loadPlaywright();
  const browser = await pw[opts.browser ?? 'chromium'].launch();
  const page = await browser.newPage({ viewport: opts.viewport ?? { width: 1600, height: 956 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text());
  });
  const issues: QaIssue[] = [];
  const shots: string[] = [];
  const sheets: string[] = [];
  const url = new URL(opts.url);
  if (opts.lang) url.searchParams.set('lang', opts.lang);
  url.searchParams.set('beat', '0');
  await page.goto(url.href);
  await page.waitForFunction(() => !!(window as unknown as { warqa?: unknown }).warqa, null, { timeout: 15000 });
  const n = (await page.evaluate('window.warqa.compiled.beats.length')) as number;
  const limit = opts.blankLimit ?? 1;
  for (let i = 0; i < n; i++) {
    const r = (await page.evaluate(`(${PROBE})(${i})`)) as {
      id: string;
      ask: boolean;
      move: string;
      first: number;
      dur: number;
      end: number;
      out: [number, number][];
      boxes: { id: string; slot: string; box: { x: number; y: number; w: number; h: number } }[];
      overflows: { id: string; fit: number }[];
      issues: { level: string; message: string }[];
    };
    for (const is of r.issues)
      if (is.level === 'error') issues.push({ beat: i, id: r.id, kind: 'compile', message: is.message });
    if (!r.ask && r.move !== 'finish') {
      const empty = r.out.filter(([, c]) => c === 0).map(([t]) => t);
      if (empty.length && empty[0]! < 3) {
        const start = Math.max(empty[0]!, r.first);
        const end = r.out.find(([t, c]) => t > empty[0]! && c > 0)?.[0] ?? r.dur;
        if (end - start > limit)
          issues.push({
            beat: i,
            id: r.id,
            kind: 'blank',
            message: `picture empty from ${start.toFixed(1)} s to ${end.toFixed(1)} s after the narration starts; show the subject at once`,
          });
      }
    }
    for (const o of r.overflows)
      if (o.fit < 0.8)
        issues.push({
          beat: i,
          id: r.id,
          kind: 'overflow',
          message: `node "${o.id}" had to shrink to ${Math.round(o.fit * 100)} % to fit its slot; shorten it or give it a larger slot`,
        });
    const live = r.boxes;
    for (let a = 0; a < live.length; a++) {
      const A = live[a]!;
      if (A.box.x < -2 || A.box.y < -2 || A.box.x + A.box.w > 1602 || A.box.y + A.box.h > 902)
        issues.push({ beat: i, id: r.id, kind: 'offstage', message: `node "${A.id}" extends outside the stage` });
      for (let b = a + 1; b < live.length; b++) {
        const B = live[b]!;
        if (A.slot === B.slot && A.slot !== 'full') continue;
        const ov = overlap(A.box, B.box);
        if (ov > 0.25)
          issues.push({
            beat: i,
            id: r.id,
            kind: 'overlap',
            message: `nodes "${A.id}" (${A.slot}) and "${B.id}" (${B.slot}) overlap; use slots that do not share space (e.g. upper + lower, start + end)`,
          });
      }
    }
    if (opts.shots) {
      mkdirSync(opts.shots, { recursive: true });
      for (const m of opts.moments ?? ['open', 'end']) {
        const t = m === 'open' ? 1.2 : m === 'mid' ? r.dur / 2 : r.ask ? r.dur : r.end - 0.05;
        await page.evaluate(`window.warqa.freeze(${i}, ${t})`);
        await page.waitForTimeout(80);
        const f = join(opts.shots, `b${String(i).padStart(2, '0')}_${m}.png`);
        await page.locator('.wq-frame').screenshot({ path: f });
        shots.push(f);
      }
    }
  }
  for (const e of errors) issues.push({ beat: -1, id: '', kind: 'error', message: e });
  if (opts.shots && shots.length) sheets.push(...(await contactSheets(page, shots, opts.shots)));
  await browser.close();
  return { issues, beats: n, shots, sheets };
}

/** 2×2 contact sheets of screenshots (half size), built in the browser. */
async function contactSheets(page: import('playwright').Page, files: string[], dir: string): Promise<string[]> {
  const { readFileSync } = await import('node:fs');
  const out: string[] = [];
  for (let k = 0; k < files.length; k += 4) {
    const imgs = files.slice(k, k + 4).map((f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`);
    const label = files.slice(k, k + 4).map((f) => f.split('/').pop()!.replace('.png', ''));
    await page.setContent(
      `<body style="margin:0;background:#000;display:grid;grid-template-columns:800px 800px;width:1600px">${imgs.map((src, j) => `<figure style="margin:0;position:relative"><img src="${src}" style="width:800px;height:450px;display:block"><figcaption style="position:absolute;top:4px;left:6px;color:#fff;font:14px sans-serif;background:#0008;padding:2px 6px">${label[j]}</figcaption></figure>`).join('')}</body>`,
    );
    const f = join(dir, `sheet_${String(k / 4).padStart(2, '0')}.png`);
    await page.screenshot({ path: f, fullPage: true });
    out.push(f);
  }
  writeFileSync(join(dir, 'index.txt'), out.join('\n'));
  return out;
}
