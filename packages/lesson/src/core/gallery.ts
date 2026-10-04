// A lesson made of every component example (one beat each): used by CI to render every component and
// action, and by authors as a visual reference.
import { COMPONENTS } from '../components/registry.js';
import { LESSON_SCHEMA, type Lesson, parseLesson } from '../schema/lesson.js';

export function galleryLesson(lang = 'en'): Lesson {
  const beats: unknown[] = [];
  for (const def of Object.values(COMPONENTS)) {
    def.examples.forEach((ex, k) => {
      const id = `${def.type}${k ? k + 1 : ''}`.replace(/[^a-z0-9]/g, '');
      const marks = (ex.cues ?? []).map((_, i) => `c${i + 1}`);
      const narration = `${def.type}: ${ex.title}.` + marks.map((m) => ` [[${m}]]Then the next change.`).join('');
      beats.push({
        id: `g-${id}`,
        title: `${def.type} — ${ex.title}`,
        move: 'example',
        narration,
        scene: {
          clear: true,
          add: [
            {
              id,
              type: def.type,
              ...(def.defaultSlot === 'title' || def.defaultSlot === 'band' ? { slot: 'main' } : {}),
              ...ex.props,
            },
          ],
        },
        cues: (ex.cues ?? []).map((c, i) => ({ ...c, at: marks[i]!, target: c.target.replace(/^x(?=#|$)/, id) })),
      });
    });
  }
  beats.push({ id: 'finish', title: 'Finished', move: 'finish', narration: 'Done.', scene: { clear: true } });
  return parseLesson({ schema: LESSON_SCHEMA, id: 'gallery', title: 'Component gallery', lang, beats });
}
