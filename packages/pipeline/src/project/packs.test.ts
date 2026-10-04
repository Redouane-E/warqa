// Third-party component packs: loaded with the project, validated like built-in components, exported.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMPONENTS, componentsFor, parseLesson, validateLesson } from '@warqa/lesson';
import { describe, expect, it } from 'vitest';
import { exportSite } from '../export/site.js';
import { Project } from './index.js';
import { packSource } from './packs.js';

const clock = resolve(import.meta.dirname, '../../../../examples/packs/clock');

describe('component packs', () => {
  it('registers, validates and exports a pack component', () => {
    const root = mkdtempSync(join(tmpdir(), 'warqa-pack-'));
    const created = Project.create(root, { id: 'p', title: 'P', langs: ['en'], defaultLang: 'en' });
    const src = packSource(clock);
    expect(src.name).toBe('warqa-pack-clock.js');
    mkdirSync(join(root, 'packs'));
    copyFileSync(src.file, join(root, 'packs', src.name));
    created.config.components = [`packs/${src.name}`];
    created.saveBook();

    const p = new Project(root); // opening the book loads its packs
    expect(COMPONENTS.clock?.external).toBe(true);
    expect(componentsFor({ packs: ['core'] }).map((d) => d.type)).toContain('clock');
    const lesson = parseLesson({
      schema: 'warqa.lesson/1',
      id: 't',
      title: 'T',
      lang: 'en',
      beats: [
        {
          id: 'b',
          title: 'B',
          move: 'example',
          narration: 'Three o’clock. [[go]]Half past four.',
          scene: { clear: true, add: [{ id: 'c', type: 'clock', hour: 3 }] },
          cues: [{ at: 'go', do: 'set', target: 'c', args: { hour: 4, minute: 30 } }],
        },
      ],
    });
    expect(validateLesson(lesson).issues.filter((i) => i.level === 'error')).toEqual([]);
    const bad = parseLesson({
      ...lesson,
      beats: [{ ...lesson.beats[0]!, cues: [{ at: 'go', do: 'set', target: 'c', args: { hour: 40 } }] }],
    });
    expect(validateLesson(bad).ok).toBe(false);

    p.saveLesson('t', lesson);
    const out = exportSite(p);
    expect(readFileSync(join(out.out, '_warqa', 'packs', 'warqa-pack-clock.js'), 'utf8')).toContain(
      'registerComponent',
    );
    const html = readFileSync(join(out.out, 't', 'index.html'), 'utf8');
    expect(html.indexOf('packs/warqa-pack-clock.js')).toBeLessThan(html.indexOf('_warqa/player.js'));
  });
});
