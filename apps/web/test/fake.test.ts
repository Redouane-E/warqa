// The test-only scripted model drives the real pipeline (plan → storyboard → beats → translation) to a valid
// lesson, in English and in Arabic.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateLesson } from '@warqa/lesson';
import { buildChapter, ensurePlan, Llm, Project, type SourceDocument } from '@warqa/pipeline';
import { afterAll, describe, expect, it } from 'vitest';
import { FAKE_MODEL, fakeModel } from '../src/worker/fake';

const doc: SourceDocument = {
  schema: 'warqa.document/1',
  source: { file: 'numbers.pdf', pages: 3, sha1: 'x', title: 'Numbers' },
  lang: 'en',
  outline: [],
  pages: [1, 2, 3].map((n) => ({ n, width: 600, height: 800, method: 'text' as const, quality: 'ok' as const })),
  blocks: [
    { id: 'p1b0', page: 1, kind: 'heading', text: 'Numbers and Operations', bbox: [0, 0, 600, 40], level: 1 },
    { id: 'p2b0', page: 2, kind: 'heading', text: 'Chapter 1 Integers', bbox: [0, 0, 600, 40], level: 1 },
    { id: 'p2b1', page: 2, kind: 'paragraph', text: 'To subtract a number, add its opposite.', bbox: [0, 50, 600, 90] },
  ],
  sections: [
    { id: '00_front', title: 'Front matter', start: 1, end: 1 },
    { id: 'ch01', title: 'Integers', start: 2, end: 3 },
  ],
};

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe('fake model', () => {
  for (const lang of ['en', 'ar']) {
    it(`plans and builds a valid ${lang} chapter with translations`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'warqa-web-fake-'));
      roots.push(root);
      const langs = lang === 'en' ? ['en', 'fr', 'ar'] : ['ar', 'fr'];
      const p = Project.create(root, { id: 'demo', title: 'Demo', langs, defaultLang: lang });
      p.config.models = Object.fromEntries(
        ['planner', 'storyboard', 'writer', 'translator', 'vision', 'judge'].map((r) => [r, FAKE_MODEL]),
      );
      p.saveBook();
      p.writeJson('source/document.json', doc);
      const llm = new Llm({ fake: fakeModel, cacheDir: p.path('cache', 'llm') });
      const plan = await ensurePlan(p, { llm, approve: true });
      expect(plan.chapters.filter((c) => c.include).map((c) => c.section)).toEqual(['ch01']);
      const r = await buildChapter(p, 'ch01', { llm, narrate: false });
      expect(validateLesson(r.lesson).ok).toBe(true);
      expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
      for (const l of langs.filter((x) => x !== lang)) expect(p.loadStrings('ch01', l)).toBeTruthy();
    });
  }
});
