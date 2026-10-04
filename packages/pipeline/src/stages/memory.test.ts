// Translation memory, review queue and glossary checks on a copy of the example book.
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type FakeModel, Llm } from '../models/llm.js';
import { Project } from '../project/index.js';
import {
  glossaryIssues,
  importReviewCsv,
  loadReview,
  parseCsv,
  rebuildMemory,
  reviewCsv,
  reviewQueue,
  reviewString,
  TranslationMemory,
} from './memory.js';
import type { BookPlan } from './plan.js';
import { translateLesson } from './translate.js';

const example = resolve(import.meta.dirname, '../../../../examples/integers.warqa');

function copy(): Project {
  const root = mkdtempSync(join(tmpdir(), 'warqa-tm-'));
  cpSync(example, root, { recursive: true, filter: (p) => !/\/(cache|dist|qa|audio)(\/|$)/.test(p) });
  const p = new Project(root);
  p.config.models = { translator: 'anthropic:claude-sonnet-5-5' };
  return p;
}

const plan = (terms: Record<string, string>[]): BookPlan =>
  ({ glossary: terms.map((t) => ({ terms: t })) }) as unknown as BookPlan;

describe('translation memory and review', () => {
  it('flags translations that ignore the glossary', () => {
    const p = copy();
    const lesson = p.loadLesson('ch05');
    const fr = p.loadStrings('ch05', 'fr')!;
    const ok = glossaryIssues(lesson, fr, plan([{ en: 'opposite', fr: 'opposé' }]), 'fr');
    expect(ok.filter((i) => i.key === 'beat.inverse.narration')).toEqual([]);
    const bad = glossaryIssues(lesson, fr, plan([{ en: 'opposite', fr: 'inverse additif' }]), 'fr');
    expect(bad.map((i) => i.key)).toContain('beat.inverse.narration');
    // Arabic: the article and attached letters do not hide a term
    const ar = p.loadStrings('ch05', 'ar')!;
    const arIssues = glossaryIssues(lesson, ar, plan([{ en: 'opposite', ar: 'مقابل' }]), 'ar');
    expect(arIssues.filter((i) => i.key === 'beat.inverse.title')).toEqual([]);
  });

  it('reuses reviewed wording and never overwrites it', async () => {
    const p = copy();
    const tm = rebuildMemory(p, 'en', 'fr');
    expect(tm.size).toBeGreaterThan(50);
    expect(reviewQueue(p, 'fr').every((i) => i.state === 'machine')).toBe(true);

    expect(reviewString(p, 'ch05', 'fr', 'beat.inverse.title', { text: 'Les nombres opposés' })).toBe('edited');
    expect(reviewString(p, 'ch05', 'fr', 'lesson.title', {})).toBe('approved');
    expect(loadReview(p, 'ch05', 'fr')['beat.inverse.title']?.status).toBe('edited');
    expect(new TranslationMemory(p, 'en', 'fr').get('Opposites')?.text).toBe('Les nombres opposés');
    // a change that breaks the narration marks is refused
    expect(() => reviewString(p, 'ch05', 'fr', 'beat.inverse.narration', { text: 'Sans marques.' })).toThrow();

    // re-translating with --force: reviewed strings stay, machine ones are redone
    let calls = 0;
    const fake: FakeModel = ({ prompt }) => {
      calls++;
      const m = /\(key: text\):\n([\s\S]*)$/.exec(prompt)!;
      const input = JSON.parse(m[1]!) as Record<string, string>;
      return JSON.stringify(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, `FR ${v}`])));
    };
    const llm = new Llm({ fake, cacheDir: p.path('cache', 'llm') });
    let reused = -1;
    const out = await translateLesson(p, 'ch05', 'fr', { llm, force: true, onMemory: (n) => (reused = n) });
    expect(calls).toBeGreaterThan(0);
    expect(out['beat.inverse.title']).toBe('Les nombres opposés');
    expect(out['lesson.title']).not.toMatch(/^FR /);
    expect(String(out['beat.intro.narration'])).toMatch(/^FR /);
    expect(reused).toBeGreaterThanOrEqual(0);
    const q = reviewQueue(p, 'fr');
    expect(q.find((i) => i.key === 'beat.inverse.title')?.state).toBe('edited');
    expect(q.find((i) => i.key === 'beat.intro.narration')?.state).toBe('machine');

    // a new language pair starts from the memory: without force, nothing is asked twice
    calls = 0;
    await translateLesson(p, 'ch05', 'fr', { llm });
    expect(calls).toBe(0);
  });

  it('round-trips a review spreadsheet', () => {
    const p = copy();
    const items = reviewQueue(p, 'ar');
    const csv = reviewCsv(items);
    expect(csv.startsWith('\ufeff')).toBe(true);
    const rows = parseCsv(csv);
    expect(rows.length).toBe(items.length + 1);
    // the narration with marks, commas and quotes survives
    const narr = rows.find((r) => r[1] === 'beat.inverse.narration')!;
    expect(narr[6]).toBe(items.find((i) => i.key === 'beat.inverse.narration')!.text);
    // a teacher edits one row and approves another (semicolon-separated export from a French spreadsheet app)
    const header = rows[0]!;
    const edit = rows.find((r) => r[1] === 'beat.inverse.title')!;
    edit[6] = 'الأعداد المتقابلة';
    const approve = rows.find((r) => r[1] === 'lesson.title')!;
    approve[7] = 'نعم';
    const sheet = [header, edit, approve].map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\n');
    const r = importReviewCsv(p, 'ar', sheet);
    expect(r).toEqual({ edited: 1, approved: 1, errors: [] });
    expect(p.loadStrings('ch05', 'ar')!['beat.inverse.title']).toBe('الأعداد المتقابلة');
    expect(loadReview(p, 'ch05', 'ar')['lesson.title']?.status).toBe('approved');
  });
});
