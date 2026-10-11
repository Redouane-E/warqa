// The saved checks of the studio's Check step (with stub checks and a scripted judge: no browser, no model), the
// judge reusing those pictures and judging only some beats, the flashcards as text and a book's backup.
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ankiText, archiveProject, BACKUP_META, BACKUP_SKIP, csvText } from '../export/packages.js';
import { type FakeModel, Llm } from '../models/llm.js';
import { Project } from '../project/index.js';
import { estimateJudge } from '../stages/build.js';
import type { checkLesson } from './check.js';
import { judgeLesson, loadVerdict, weakBeats } from './judge.js';
import { checkChapter, checkFresh, loadCheck } from './report.js';

const example = resolve(import.meta.dirname, '../../../../examples/integers.warqa');

function copy(): Project {
  const root = mkdtempSync(join(tmpdir(), 'warqa-check-'));
  cpSync(example, root, { recursive: true, filter: (p) => !/\/(cache|dist|qa)(\/|$)/.test(p) });
  const p = new Project(root);
  p.config.models = { judge: 'anthropic:claude-sonnet-5-5' };
  return p;
}

/** A check that "renders" each beat: one finding on beat 1, a picture per beat. */
const stubCheck =
  (p: Project): typeof checkLesson =>
  async (o) => {
    const lesson = p.loadLesson('ch05');
    mkdirSync(o.shots!, { recursive: true });
    const ends: Record<number, string> = {};
    const thumbs: Record<number, string> = {};
    lesson.beats.forEach((_, i) => {
      ends[i] = join(o.shots!, `b${String(i).padStart(2, '0')}_end.png`);
      thumbs[i] = ends[i]!.replace(/\.png$/, '.jpg');
      writeFileSync(ends[i]!, 'png');
      writeFileSync(thumbs[i]!, 'jpg');
      o.onBeat?.(i, lesson.beats.length);
    });
    return {
      beats: lesson.beats.length,
      shots: Object.values(ends),
      sheets: [],
      ends,
      thumbs,
      beatInfo: lesson.beats.map((b, i) => ({ id: b.id, index: i, dur: 10, end: 10, ask: false, move: b.move })),
      issues: [
        {
          beat: 1,
          id: lesson.beats[1]!.id,
          kind: 'overlap',
          message: 'nodes overlap',
          nodes: ['a', 'b'],
          box: { x: 10, y: 10, w: 100, h: 50 },
        },
      ],
    };
  };

describe('saved checks', () => {
  it('keeps a chapter’s pictures and findings, and the judge scores those same pictures', async () => {
    const p = copy();
    const seen: number[] = [];
    let judged: Record<number, string> | undefined;
    const saved = await checkChapter(p, 'ch05', 'en', {
      url: 'http://example.invalid/ch05/index.html',
      check: stubCheck(p),
      onBeat: (i) => seen.push(i),
      judge: { llm: new Llm({ fake: () => '{}', cacheDir: p.path('cache', 'llm') }) },
      judgeFn: async (_p, _l, o) => {
        judged = o.shots;
        return [];
      },
    });
    expect(seen.length).toBe(p.loadLesson('ch05').beats.length);
    expect(saved.judged).toBe(true);
    expect(Object.keys(judged ?? {}).length).toBe(seen.length);
    const back = loadCheck(p, 'ch05', 'en')!;
    expect(back.beats[0]).toMatchObject({ index: 0, shot: 'b00_end.png', thumb: 'b00_end.jpg' });
    expect(back.beats[0]!.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(back.issues[0]).toMatchObject({ kind: 'overlap', nodes: ['a', 'b'] });
    // the check still shows the lesson as it is: the judge's verdict from it can be trusted
    expect(checkFresh(p, 'ch05', 'en')).toBe(true);
    // a check that fails leaves the earlier one whole, its pictures too
    await expect(
      checkChapter(p, 'ch05', 'en', {
        url: 'http://example.invalid/',
        check: async () => {
          throw new Error('no browser');
        },
      }),
    ).rejects.toThrow('no browser');
    expect(existsSync(p.path('qa', 'ch05', 'en', 'b00_end.jpg'))).toBe(true);
    expect(loadCheck(p, 'ch05', 'en')?.at).toBe(back.at);
    // the lesson changes: the check is out of date
    const lesson = p.loadLesson('ch05');
    lesson.beats[0]!.title = 'Another title';
    p.saveLesson('ch05', lesson);
    expect(checkFresh(p, 'ch05', 'en')).toBe(false);
  });

  it('judges given pictures, only some beats, keeping the verdict of the others', async () => {
    const p = copy();
    const lesson = p.loadLesson('ch05');
    const ids = lesson.beats.filter((b) => !b.questions?.length && b.move !== 'finish').map((b) => b.id);
    const shots = Object.fromEntries(
      lesson.beats.map((_, i) => {
        const f = p.path('qa', `b${i}.png`);
        mkdirSync(p.path('qa'), { recursive: true });
        writeFileSync(f, 'png');
        return [i, f];
      }),
    );
    const asked: string[][] = [];
    const fake: FakeModel = ({ prompt }) => {
      const beats = [...prompt.matchAll(/beat "([\w-]+)"/g)].map((m) => m[1]!);
      asked.push(beats);
      return JSON.stringify({ beats: beats.map((id) => ({ id, score: id === ids[0] ? 2 : 5, fix: 'Move it.' })) });
    };
    const llm = new Llm({ fake, cacheDir: p.path('cache', 'llm') });
    await judgeLesson(p, 'ch05', { llm, lang: 'en', shots });
    expect(loadVerdict(p, 'ch05', 'en').length).toBe(ids.length);
    expect(weakBeats(loadVerdict(p, 'ch05', 'en'), 4).map((v) => v.id)).toEqual([ids[0]]);
    // the first beat judged again (now good): the others keep their verdict
    asked.length = 0;
    const fake2: FakeModel = ({ prompt }) => {
      const beats = [...prompt.matchAll(/beat "([\w-]+)"/g)].map((m) => m[1]!);
      asked.push(beats);
      return JSON.stringify({ beats: beats.map((id) => ({ id, score: 4 })) });
    };
    await judgeLesson(p, 'ch05', {
      llm: new Llm({ fake: fake2, cacheDir: p.path('cache', 'llm2') }),
      lang: 'en',
      shots,
      beats: [ids[0]!],
    });
    expect(asked).toEqual([[ids[0]]]);
    const v = loadVerdict(p, 'ch05', 'en');
    expect(v.length).toBe(ids.length);
    expect(v.find((x) => x.id === ids[0])?.score).toBe(4);
    expect(v.find((x) => x.id === ids[1])?.score).toBe(5);
    // what judging costs: four beats a call
    expect(estimateJudge(p, 4)).toBeGreaterThan(0);
    expect(estimateJudge(p, 0)).toBe(0);
  });
});

describe('sharing', () => {
  it('writes the flashcards as text for Anki and as CSV', () => {
    const p = copy();
    const anki = ankiText(p, 'fr');
    expect(anki.startsWith('#separator:tab\n#html:true')).toBe(true);
    expect(anki.split('\n').length).toBeGreaterThan(4);
    expect(csvText(p, 'ar').startsWith('\ufefffront,back\n')).toBe(true);
  });

  it('backs a book up without what is made again, keeping the saved checks and the judge’s scores', () => {
    const p = copy();
    mkdirSync(p.path('dist'), { recursive: true });
    writeFileSync(p.path('dist', 'index.html'), 'x');
    mkdirSync(p.path('qa', 'ch05', 'en'), { recursive: true });
    writeFileSync(p.path('qa', 'ch05', 'en', 'b00_end.png'), 'big');
    writeFileSync(p.path('qa', 'ch05', 'en', 'b00_end.jpg'), 'small');
    writeFileSync(p.path('qa', 'ch05', 'en-judge.json'), '[]');
    mkdirSync(p.path('cache', 'llm'), { recursive: true });
    writeFileSync(p.path('cache', 'llm', 'a.json'), '{}');
    mkdirSync(p.path('cache', 'judge-site'), { recursive: true });
    writeFileSync(p.path('cache', 'judge-site', 'x.html'), 'x');
    // hidden files stay out (a .env may hold keys), but the spending ledger is kept
    writeFileSync(p.path('.env'), 'ANTHROPIC_API_KEY=secret');
    mkdirSync(p.path('.git'), { recursive: true });
    writeFileSync(p.path('.git', 'config'), 'x');
    writeFileSync(p.path('.ledger.jsonl'), '{}\n');
    const names = Object.keys(unzipSync(archiveProject(p))).map((n) => n.split('/').slice(1).join('/'));
    expect(names).toContain('warqa.json');
    expect(names).toContain('lessons/ch05/lesson.json');
    expect(names).toContain('qa/ch05/en-judge.json');
    expect(names).toContain('qa/ch05/en/b00_end.jpg');
    expect(names).toContain('cache/llm/a.json');
    expect(names).not.toContain('qa/ch05/en/b00_end.png');
    expect(names).not.toContain('dist/index.html');
    expect(names).not.toContain('cache/judge-site/x.html');
    expect(names).not.toContain('.env');
    expect(names).not.toContain('.git/config');
    expect(names).toContain('.ledger.jsonl');
    // when it was made, written afresh beside warqa.json (an old one left in the folder is not copied)
    writeFileSync(p.path(BACKUP_META), '{"format":1,"exported":"2001-01-01T00:00:00.000Z"}');
    const zip = unzipSync(archiveProject(p));
    const meta = Object.entries(zip).find(([n]) => n.endsWith(`/${BACKUP_META}`));
    expect(Object.keys(zip).filter((n) => n.endsWith(`/${BACKUP_META}`))).toHaveLength(1);
    const made = JSON.parse(new TextDecoder().decode(meta![1])) as { exported: string };
    expect(Date.now() - Date.parse(made.exported)).toBeLessThan(60_000);
    // and an import never keeps it in the book
    expect(BACKUP_SKIP.test(BACKUP_META)).toBe(true);
  });
});
