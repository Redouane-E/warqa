// Export the example books (and a gallery of every component) and serve them for the tests (static server
// with Range support):
//   /               integers.warqa: chapter 5 in en/fr/ar
//   /fox/           fox.warqa: picture book read word by word, in ar/ary/fr/en
//   /morocco/       morocco.warqa: maps with regions and a pick question
//   /gallery/       every component's examples (typeset math, maps, widgets…), en
//   /clock/         a book using a third-party component pack (examples/packs/clock)
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { galleryLesson } from '@warqa/lesson';
import { exportSite, Project, serveStatic } from '@warqa/pipeline';

const example = (name: string) => fileURLToPath(new URL(`../examples/${name}.warqa`, import.meta.url));

export default async function globalSetup() {
  const out = fileURLToPath(new URL('./.site', import.meta.url));
  exportSite(new Project(example('integers')), { out });
  exportSite(new Project(example('fox')), { out: join(out, 'fox') });
  exportSite(new Project(example('morocco')), { out: join(out, 'morocco') });
  const gallery = Project.create(join(mkdtempSync(join(tmpdir(), 'warqa-e2e-')), 'gallery.warqa'), {
    id: 'gallery',
    title: 'Gallery',
    langs: ['en'],
    defaultLang: 'en',
  });
  gallery.saveLesson('gallery', galleryLesson('en'));
  exportSite(gallery, { out: join(out, 'gallery'), pwa: false });
  // a book with a component pack: the pack's script is copied into the book and loads before the player
  const clockRoot = join(mkdtempSync(join(tmpdir(), 'warqa-e2e-')), 'clock.warqa');
  const made = Project.create(clockRoot, { id: 'clock', title: 'Clock', langs: ['en'], defaultLang: 'en' });
  mkdirSync(made.path('packs'));
  copyFileSync(
    fileURLToPath(new URL('../examples/packs/clock/pack.js', import.meta.url)),
    made.path('packs', 'clock.js'),
  );
  made.config.components = ['packs/clock.js'];
  made.saveBook();
  const clock = new Project(clockRoot);
  clock.saveLesson('time', {
    schema: 'warqa.lesson/1',
    id: 'time',
    title: 'Telling the time',
    lang: 'en',
    beats: [
      {
        id: 'b1',
        title: 'Half past four',
        move: 'example',
        narration: "It is three o'clock. [[half]]Now it is half past four.",
        scene: { clear: true, add: [{ id: 'c', type: 'clock', hour: 3, minute: 0, digital: true }] },
        cues: [{ at: 'half', do: 'set', target: 'c', args: { hour: 4, minute: 30 } }],
      },
      {
        id: 'q',
        title: 'Which hand?',
        move: 'check',
        narration: 'Which hand shows the hours?',
        scene: { clear: true, add: [{ id: 'c2', type: 'clock', hour: 9, minute: 15 }] },
        cues: [],
        questions: [
          {
            kind: 'pick',
            id: 'hh',
            prompt: 'Click the hour hand.',
            on: 'c2',
            correct: ['hour'],
            explain: 'The short hand shows the hours.',
          },
        ],
      },
    ],
  });
  exportSite(clock, { out: join(out, 'clock'), pwa: false });
  process.env.WARQA_E2E_SITE = out;
  const { server } = await serveStatic(out, 8799);
  return async () => {
    server.close();
  };
}
