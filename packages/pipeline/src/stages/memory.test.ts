// Translation memory, review queue and glossary checks on a copy of the example book.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type FakeModel, Llm } from '../models/llm.js';
import { Project } from '../project/index.js';
import { estimateTranslate } from './build.js';
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
import { changedBeats, loadSources, moveStringKeys } from './sources.js';
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
    // the preview says what would change and writes nothing
    const dry = importReviewCsv(p, 'ar', sheet, { dry: true });
    expect(dry.changes.map((c) => [c.key, c.kind])).toEqual([
      ['beat.inverse.title', 'edited'],
      ['lesson.title', 'approved'],
    ]);
    expect(p.loadStrings('ch05', 'ar')!['beat.inverse.title']).not.toBe('الأعداد المتقابلة');
    expect(loadReview(p, 'ch05', 'ar')['lesson.title']).toBeUndefined();
    const r = importReviewCsv(p, 'ar', sheet);
    expect(r).toMatchObject({ edited: 1, approved: 1, errors: [] });
    expect(loadReview(p, 'ch05', 'ar')['beat.inverse.title']?.by).toBe('sheet');
    expect(p.loadStrings('ch05', 'ar')!['beat.inverse.title']).toBe('الأعداد المتقابلة');
    expect(loadReview(p, 'ch05', 'ar')['lesson.title']?.status).toBe('approved');
  });

  it('says where each string sits, what is wrong with it, and the glossary terms it should use', () => {
    const p = copy();
    const fr = p.loadStrings('ch05', 'fr')!;
    const narr = String(fr['beat.rule.narration']);
    p.saveStrings('ch05', 'fr', { ...fr, 'beat.rule.narration': narr.replace(/\[\[keep\]\]/, '') });
    const q = reviewQueue(p, 'fr', { plan: plan([{ en: 'opposite', fr: 'opposé' }]) });
    const item = q.find((i) => i.key === 'beat.rule.narration')!;
    expect(item.field).toBe('narration');
    expect(item.beat).toMatchObject({ n: 3, id: 'rule' });
    expect(item.problems).toEqual([expect.objectContaining({ code: 'marks', lost: ['keep'], blocking: true })]);
    expect(item.glossary).toEqual([{ term: 'opposite', expected: 'opposé', used: true }]);
    expect(q.find((i) => i.key === 'lesson.title')?.field).toBe('lesson-title');
    const part = q.find((i) => i.key.startsWith('node.'))!;
    expect(part.field).toBe('part');
    expect(part.part?.type).toBeTruthy();
  });

  it('marks a model translation whose original changed, and translates it again', async () => {
    const p = copy();
    const lesson = p.loadLesson('ch05');
    // a book from before the records: the first edit writes them from the lesson as it was
    const intro = lesson.beats.find((b) => b.id === 'intro')!;
    const was = intro.title;
    intro.title = 'Subtracting, in a new way';
    p.saveLesson('ch05', lesson);
    const stale = reviewQueue(p, 'fr').find((i) => i.key === 'beat.intro.title')!;
    expect(stale.state).toBe('stale');
    expect(stale.before).toBe(was);
    expect(reviewQueue(p, 'fr').find((i) => i.key === 'beat.rule.title')?.state).toBe('machine');
    // what it costs to bring French up to date: the changed string only
    expect(estimateTranslate(p, 'fr')?.strings).toBe(1);
    // translating again redoes only that string
    const asked: string[] = [];
    const fake: FakeModel = ({ prompt }) => {
      const m = /\(key: text\):\n([\s\S]*)$/.exec(prompt)!;
      const input = JSON.parse(m[1]!) as Record<string, string>;
      asked.push(...Object.keys(input));
      return JSON.stringify(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, `FR ${v}`])));
    };
    const llm = new Llm({ fake, cacheDir: p.path('cache', 'llm') });
    const out = await translateLesson(p, 'ch05', 'fr', { llm });
    expect(asked).toEqual(['beat.intro.title']);
    expect(out['beat.intro.title']).toBe('FR Subtracting, in a new way');
    expect(reviewQueue(p, 'fr').find((i) => i.key === 'beat.intro.title')?.state).toBe('machine');
    expect(estimateTranslate(p, 'fr')?.strings).toBe(0);
    // "Keep mine" on a person's wording whose original changed: checked again, still theirs
    reviewString(p, 'ch05', 'fr', 'beat.rule.title', { text: 'La règle, à ma façon' });
    const l2 = p.loadLesson('ch05');
    l2.beats.find((b) => b.id === 'rule')!.title = 'The rule, again';
    p.saveLesson('ch05', l2);
    expect(reviewQueue(p, 'fr').find((i) => i.key === 'beat.rule.title')?.state).toBe('stale');
    // a person's wording is never translated over by the model
    asked.length = 0;
    await translateLesson(p, 'ch05', 'fr', { llm });
    expect(asked).toEqual([]);
    expect(reviewString(p, 'ch05', 'fr', 'beat.rule.title', { keep: true })).toBe('edited');
    expect(reviewQueue(p, 'fr').find((i) => i.key === 'beat.rule.title')?.state).toBe('edited');
    // "Translate again" on one row asks for that row only, even a person's
    await translateLesson(p, 'ch05', 'fr', { llm, keys: ['beat.rule.title'] });
    expect(asked).toEqual(['beat.rule.title']);
    expect(reviewQueue(p, 'fr').find((i) => i.key === 'beat.rule.title')?.state).toBe('machine');
  });

  it('knows which recordings no longer match what a beat says', () => {
    const p = copy();
    // a recording of every beat in English, as it was made
    const lesson = p.loadLesson('ch05');
    const dir = p.audioDir('ch05', 'en');
    mkdirSync(dir, { recursive: true });
    for (const b of lesson.beats) writeFileSync(join(dir, `${b.id}.mp3`), 'x');
    expect(changedBeats(p, 'ch05', 'en')).toEqual([]);
    lesson.beats[1]!.narration = `${lesson.beats[1]!.narration} One more sentence.`;
    p.saveLesson('ch05', lesson);
    expect(changedBeats(p, 'ch05', 'en')).toEqual([lesson.beats[1]!.id]);
    // another voice: every recording is out of date
    p.config.tts.voices.en = 'en-GB-SoniaNeural';
    expect(changedBeats(p, 'ch05', 'en')).toHaveLength(lesson.beats.length);
  });

  it('records every translation of an older book at its first check, so a later edit shows', () => {
    const p = copy();
    // approving one row of a book made before records were kept
    reviewString(p, 'ch05', 'fr', 'beat.rule.title', {});
    const lesson = p.loadLesson('ch05');
    lesson.beats.find((b) => b.id === 'intro')!.title = 'Subtracting, once more';
    p.saveLesson('ch05', lesson);
    expect(reviewQueue(p, 'fr').find((i) => i.key === 'beat.intro.title')?.state).toBe('stale');
  });

  it('translates again only the rows asked for, and a person’s wording sent to the model is theirs no more', async () => {
    const p = copy();
    const lesson = p.loadLesson('ch05');
    lesson.beats.find((b) => b.id === 'intro')!.title = 'Subtracting, once more';
    lesson.beats.find((b) => b.id === 'inverse')!.title = 'Opposite numbers';
    p.saveLesson('ch05', lesson);
    const fr = p.loadStrings('ch05', 'fr')!;
    const { 'beat.ex1.title': _gone, ...without } = fr;
    p.saveStrings('ch05', 'fr', without);
    const asked: string[] = [];
    const fake: FakeModel = ({ prompt }) => {
      const m = /\(key: text\):\n([\s\S]*)$/.exec(prompt)!;
      const input = JSON.parse(m[1]!) as Record<string, string>;
      asked.push(...Object.keys(input));
      return JSON.stringify(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, `FR ${v}`])));
    };
    const llm = new Llm({ fake, cacheDir: p.path('cache', 'llm') });
    await translateLesson(p, 'ch05', 'fr', { llm, keys: ['beat.intro.title'] });
    expect(asked).toEqual(['beat.intro.title']);
    const after = p.loadStrings('ch05', 'fr')!;
    // the other changed row is untouched, the missing one stays missing (not filled with the original's text)
    expect(after['beat.inverse.title']).toBe(fr['beat.inverse.title']);
    expect(after['beat.ex1.title']).toBeUndefined();
    // "Make again": a person's wording sent to the model loses its check
    reviewString(p, 'ch05', 'fr', 'beat.rule.title', { text: 'La règle, à ma façon' });
    const l2 = p.loadLesson('ch05');
    l2.beats.find((b) => b.id === 'rule')!.title = 'The rule, again';
    p.saveLesson('ch05', l2);
    await translateLesson(p, 'ch05', 'fr', { llm, force: true });
    expect(loadReview(p, 'ch05', 'fr')['beat.rule.title']).toBeUndefined();
    expect(reviewQueue(p, 'fr').find((i) => i.key === 'beat.rule.title')?.state).toBe('machine');
  });

  it('takes back what Undo withdraws from the translation memory too', () => {
    const p = copy();
    rebuildMemory(p, 'en', 'fr');
    const item = reviewQueue(p, 'fr').find((i) => i.key === 'beat.rule.title')!;
    reviewString(p, 'ch05', 'fr', item.key, {});
    expect(new TranslationMemory(p, 'en', 'fr').get(item.source)?.status).toBe('approved');
    reviewString(p, 'ch05', 'fr', item.key, { approve: false });
    expect(new TranslationMemory(p, 'en', 'fr').get(item.source)?.status).toBe('machine');
  });

  it('moves translations with their checks and records when an id is renamed', () => {
    const p = copy();
    reviewString(p, 'ch05', 'fr', 'beat.rule.title', {});
    expect(moveStringKeys(p, 'ch05', [[{ from: 'beat.rule.', to: 'beat.rule2.' }]])).toBeGreaterThan(0);
    expect(p.loadStrings('ch05', 'fr')!['beat.rule2.title']).toBeDefined();
    expect(loadReview(p, 'ch05', 'fr')['beat.rule2.title']).toBeDefined();
    expect(loadSources(p, 'ch05', 'fr')?.['beat.rule2.title']).toBeDefined();
    expect(loadSources(p, 'ch05', 'fr')?.['beat.rule.title']).toBeUndefined();
  });
});
