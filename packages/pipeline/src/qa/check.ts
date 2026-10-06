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
  /** The parts involved (overlap: both; overflow, offstage: one), by node id. */
  nodes?: string[];
  /** Where on the stage (1600 × 900): the overlapping area, or the part's box. */
  box?: { x: number; y: number; w: number; h: number };
  /** Blank: from when to when (seconds after the narration starts). */
  from?: number;
  to?: number;
  /** Overflow: the scale the part had to shrink to (0–1). */
  fit?: number;
}

/** One beat as the check saw it: how long it lasts and where it ends. */
export interface QaBeat {
  id: string;
  index: number;
  dur: number;
  end: number;
  ask: boolean;
  move: string;
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
  /** Look at the lesson on the white Sheet or the navy Board (default: the book's theme). */
  theme?: 'sheet' | 'board';
  /** Also write a small JPEG (480 × 270) of each end shot, `bNN_end.jpg`, for a contact sheet. */
  thumbs?: boolean;
  /** After each beat is checked (i is 0-based). */
  onBeat?: (i: number, n: number) => void;
}

export interface QaResult {
  issues: QaIssue[];
  beats: number;
  shots: string[];
  sheets: string[];
  /** Each beat's length and end, in order. */
  beatInfo: QaBeat[];
  /** The small end pictures written (`thumbs`), by beat index. */
  thumbs: Record<number, string>;
  /** The end shots, by beat index. */
  ends: Record<number, string>;
}

type PW = typeof import('playwright');

/** Can Playwright be loaded here (the desktop, with it installed)? Its browsers may still need installing. */
export function hasPlaywright(): boolean {
  try {
    import.meta.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

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
  const beatInfo: QaBeat[] = [];
  const ends: Record<number, string> = {};
  const thumbs: Record<number, string> = {};
  const url = new URL(opts.url);
  if (opts.lang) url.searchParams.set('lang', opts.lang);
  if (opts.theme) url.searchParams.set('theme', opts.theme);
  url.searchParams.set('beat', '0');
  // the stage alone, at full size: the shots and the checks look at the picture, not the page around it
  url.searchParams.set('bare', '');
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
    beatInfo.push({ id: r.id, index: i, dur: r.dur, end: r.end, ask: r.ask, move: r.move });
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
            from: +start.toFixed(1),
            to: +end.toFixed(1),
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
          nodes: [o.id],
          fit: +o.fit.toFixed(2),
          ...(r.boxes.find((b) => b.id === o.id) ? { box: r.boxes.find((b) => b.id === o.id)!.box } : {}),
        });
    const live = r.boxes;
    for (let a = 0; a < live.length; a++) {
      const A = live[a]!;
      if (A.box.x < -2 || A.box.y < -2 || A.box.x + A.box.w > 1602 || A.box.y + A.box.h > 902)
        issues.push({
          beat: i,
          id: r.id,
          kind: 'offstage',
          message: `node "${A.id}" extends outside the stage`,
          nodes: [A.id],
          box: A.box,
        });
      for (let b = a + 1; b < live.length; b++) {
        const B = live[b]!;
        if (A.slot === B.slot && A.slot !== 'full') continue;
        const ov = overlap(A.box, B.box);
        if (ov > 0.25) {
          // where they meet: the common area of the two boxes
          const x = Math.max(A.box.x, B.box.x);
          const y = Math.max(A.box.y, B.box.y);
          issues.push({
            beat: i,
            id: r.id,
            kind: 'overlap',
            message: `nodes "${A.id}" (${A.slot}) and "${B.id}" (${B.slot}) overlap; use slots that do not share space (e.g. upper + lower, start + end)`,
            nodes: [A.id, B.id],
            box: {
              x,
              y,
              w: Math.min(A.box.x + A.box.w, B.box.x + B.box.w) - x,
              h: Math.min(A.box.y + A.box.h, B.box.y + B.box.h) - y,
            },
          });
        }
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
        if (m === 'end') ends[i] = f;
      }
    }
    opts.onBeat?.(i, n);
  }
  // small pictures for a contact sheet, drawn in a blank page (the lesson's own page may forbid data: images)
  if (opts.thumbs && Object.keys(ends).length) {
    const { readFileSync } = await import('node:fs');
    const tp = await browser.newPage();
    for (const [k, f] of Object.entries(ends)) {
      const src = `data:image/png;base64,${readFileSync(f).toString('base64')}`;
      const jpg = (await tp.evaluate(async (s: string) => {
        const img = new Image();
        img.src = s;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 480;
        c.height = 270;
        c.getContext('2d')!.drawImage(img, 0, 0, 480, 270);
        return c.toDataURL('image/jpeg', 0.72);
      }, src)) as string;
      const out = f.replace(/\.png$/, '.jpg');
      writeFileSync(out, Buffer.from(jpg.split(',')[1]!, 'base64'));
      thumbs[Number(k)] = out;
    }
    await tp.close();
  }
  for (const e of errors) issues.push({ beat: -1, id: '', kind: 'error', message: e });
  if (opts.shots && shots.length) sheets.push(...(await contactSheets(page, shots, opts.shots)));
  await browser.close();
  return { issues, beats: n, shots, sheets, beatInfo, thumbs, ends };
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
