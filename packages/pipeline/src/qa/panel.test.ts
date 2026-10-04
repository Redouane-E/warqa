// Teacher panel: a blind kit of two "models", ratings files, and the scored table.
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project } from '../project/index.js';
import { exportPanelKit, panelMarkdown, type RatingsFile, scorePanel } from './panel.js';

const example = resolve(import.meta.dirname, '../../../../examples/integers.warqa');
const copy = (name: string) => {
  const root = join(mkdtempSync(join(tmpdir(), 'warqa-panel-')), name);
  cpSync(example, root, { recursive: true, filter: (p) => !/\/(cache|dist|qa|audio)(\/|$)/.test(p) });
  return new Project(root);
};

describe('teacher panel', () => {
  it('exports a blind kit and scores the ratings', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'warqa-kit-')), 'kit');
    const { key, keyFile } = exportPanelKit(
      [
        { project: copy('a'), lesson: 'ch05', label: 'model-one' },
        { project: copy('b'), lesson: 'ch05', label: 'model-two' },
      ],
      { out, kit: 'k1' },
    );
    expect(Object.keys(key.codes).sort()).toEqual(['A', 'B']);
    expect(existsSync(keyFile)).toBe(true);
    expect(keyFile.startsWith(join(out, '/'))).toBe(false); // the key is next to the kit, not inside it
    const page = readFileSync(join(out, 'A', 'ch05', 'index.html'), 'utf8');
    expect(page).toContain('"panel":{"kit":"k1","code":"A"}');
    expect(page).not.toContain('model-one');

    const codeOf = (label: string) => Object.entries(key.codes).find(([, v]) => v.label === label)![0];
    const file = (scores: [number, number], use: 'yes' | 'no'): RatingsFile => ({
      schema: 'warqa.ratings/1',
      kit: 'k1',
      rater: { at: '2026-10-04T00:00:00Z' },
      lessons: {
        [codeOf('model-one')]: {
          lang: 'ar',
          beats: { intro: { accuracy: scores[0], clarity: 5 }, rule: { accuracy: scores[1] } },
          overall: { score: scores[0], use },
        },
        [codeOf('model-two')]: { lang: 'ar', beats: { intro: { accuracy: 2 } }, overall: { score: 2, use: 'no' } },
      },
    });
    const rows = scorePanel([file([5, 4], 'yes'), file([4, 4], 'yes'), { ...file([1, 1], 'no'), kit: 'other' }], key);
    expect(rows[0]).toMatchObject({ label: 'model-one', raters: 2, steps: 4, use: { yes: 2, changes: 0, no: 0 } });
    expect(rows[0]!.means.accuracy).toBe(4.25);
    expect(rows[0]!.means.overall).toBe(4.5);
    expect(rows[1]).toMatchObject({ label: 'model-two', raters: 2 });
    expect(panelMarkdown(rows, 'k1')).toContain('| model-one | 2 | 4 | 4.25 | 5.00 |');
  });
});
