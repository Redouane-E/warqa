// A scripted "model" for tests and demos without a network: it answers each pipeline call (plan, storyboard,
// beats, translation, page reading) with small valid content, through the pipeline's FakeModel hook in Llm.
// Enabled only by ?warqa-fake=1 (or VITE_WARQA_FAKE=1 at build time); never offered otherwise.
import type { FakeModel } from '@warqa/pipeline';

/** The id the fake provider shows in model settings. */
export const FAKE_MODEL = 'fake:scripted';

type Lang = 'ar' | 'latin';

/** The language the pipeline asked for ("Write every learner-facing string … in French."). */
const langOf = (prompt: string): Lang =>
  /learner-facing string[^\n]*\bin [^\n]*Arabic/.test(prompt) || /written in Modern Standard Arabic/.test(prompt)
    ? 'ar'
    : 'latin';

const T = {
  latin: {
    title: 'Subtracting integers',
    intro: 'Seven minus three is four. [[b]]Seven plus negative three is four too.',
    rule: 'Here is the rule. [[keep]]Keep the seven. [[chg]]Change minus to plus and three to negative three.',
    ruleTitle: 'Add the opposite',
    check: 'Quick check.',
    checkTitle: 'Quick check',
    where: 'Where does $7 − 3$ land?',
    wrap: 'To subtract, add the opposite.',
    wrapTitle: 'Summary',
    practice: 'Chapter practice.',
    practiceTitle: 'Practice',
    find: 'Find each difference.',
    finish: 'Well done.',
    finishTitle: 'Finished',
  },
  ar: {
    title: 'طرح الأعداد الصحيحة',
    intro: 'سبعة ناقص ثلاثة يساوي أربعة. [[b]]وسبعة زائد سالب ثلاثة يساوي أربعة أيضًا.',
    rule: 'هذه هي القاعدة. [[keep]]نحتفظ بالسبعة. [[chg]]نحوّل الطرح إلى جمع والثلاثة إلى مقابلها.',
    ruleTitle: 'نضيف المقابل',
    check: 'تحقّق سريع.',
    checkTitle: 'تحقّق سريع',
    where: 'أين يقع $7 − 3$؟',
    wrap: 'لنطرح عددًا نضيف مقابله.',
    wrapTitle: 'خلاصة',
    practice: 'تمارين الفصل.',
    practiceTitle: 'تمارين',
    find: 'أوجد كل فرق.',
    finish: 'أحسنت.',
    finishTitle: 'النهاية',
  },
};

const beats: Record<string, (l: Lang, page: number) => unknown> = {
  intro: (l, page) => ({
    title: T[l].title,
    narration: T[l].intro,
    scene: {
      clear: true,
      add: [{ id: 'tc', type: 'title', title: T[l].title, lines: ['$7 − 3 = 4$', '$7 + (−3) = 4$'] }],
    },
    cues: [{ at: 'b', do: 'show', target: 'tc#line:1' }],
    sources: [{ page }],
  }),
  rule: (l, page) => ({
    title: T[l].ruleTitle,
    narration: T[l].rule,
    scene: {
      clear: true,
      add: [
        { id: 'nl', type: 'numberline', min: -8, max: 8 },
        {
          id: 'eq',
          type: 'equation',
          steps: [
            ['7', ' − ', '3'],
            ['7', ' + ', '(−3)'],
          ],
        },
      ],
    },
    cues: [
      { at: 'chg', do: 'step', target: 'eq' },
      { at: 'keep', do: 'highlight', target: 'eq#tok:0' },
    ],
    sources: [{ page }],
  }),
  q1: (l, page) => ({
    title: T[l].checkTitle,
    narration: T[l].check,
    scene: { clear: false },
    cues: [],
    card: { place: 'band', label: 'check' },
    questions: [
      { kind: 'pick', id: 'c-land', prompt: T[l].where, on: 'nl', correct: ['tick:4'], explain: '$7 + (−3) = 4$.' },
    ],
    sources: [{ page }],
  }),
  wrap: (l, page) => ({
    title: T[l].wrapTitle,
    narration: T[l].wrap,
    scene: { clear: true, add: [{ id: 'sum', type: 'list', items: [{ text: T[l].wrap, sub: '$a − b = a + (−b)$' }] }] },
    cues: [],
    sources: [{ page }],
  }),
  final1: (l, page) => ({
    title: T[l].practiceTitle,
    narration: T[l].practice,
    scene: { clear: true },
    cues: [],
    card: { place: 'screen', label: 'practice' },
    questions: [
      { kind: 'blanks', id: 'p-d', prompt: T[l].find, rows: [{ template: '3 − 10 = [[a]]', answers: { a: '-7' } }] },
    ],
    sources: [{ page }],
  }),
  finish: (l) => ({ title: T[l].finishTitle, narration: T[l].finish, scene: { clear: true }, cues: [], sources: [] }),
};

const STORY: [string, string, string[]][] = [
  ['intro', 'intro', ['title']],
  ['rule', 'transform', ['numberline', 'equation']],
  ['q1', 'check', []],
  ['wrap', 'summary', ['list']],
  ['final1', 'practice', []],
  ['finish', 'finish', []],
];

/** Pull the JSON object that follows a marker in a prompt (translation input). */
function jsonAfter(prompt: string, marker: RegExp): Record<string, string> {
  const m = marker.exec(prompt);
  if (!m) return {};
  const s = prompt.slice(m.index + m[0].length);
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, string>;
  } catch {
    return {};
  }
}

export const fakeModel: FakeModel = ({ name, prompt }) => {
  if (name === 'plan') {
    const sections = [...prompt.matchAll(/^- (\S+) \| pages (\d+)-(\d+)(?: \| unit: [^|\n]*)? \| (.*)$/gm)].map(
      (m) => ({
        id: m[1]!,
        title: m[4]!.trim() || m[1]!,
      }),
    );
    const teach = sections.filter((s) => !/^0+_|front|index|answers?/i.test(s.id));
    const chosen = teach.length ? teach : sections.slice(0, 1);
    return JSON.stringify({
      title: /^Book: (.*?) \(/m.exec(prompt)?.[1] ?? 'Book',
      audience: 'middle school',
      chapters: sections.map((s) => ({
        section: s.id,
        title: s.title.slice(0, 80),
        objectives: ['Subtract by adding the opposite'],
        minutes: 6,
        visuals: ['number line hops'],
        packs: ['stem'],
        include: chosen.includes(s),
      })),
      glossary: [{ terms: { en: 'opposite', fr: 'opposé', ar: 'مقابل' } }],
      conventions: { notation: 'true minus', colors: 'positive sky, negative coral', tone: 'warm' },
    });
  }
  if (name.startsWith('storyboard')) {
    const l = langOf(prompt);
    const page = Number(/pages (\d+)–/.exec(prompt)?.[1] ?? 1);
    return JSON.stringify({
      title: T[l].title,
      beats: STORY.map(([id, move, components]) => ({
        id,
        move,
        title: id,
        idea: 'idea',
        visual: 'visual',
        components,
        keep: [],
        pages: [page],
        seconds: 10,
      })),
    });
  }
  if (name.startsWith('beat:') || name.startsWith('beat-lite:')) {
    const id = name.split(':')[2]!;
    const page = Number(/Source text \(pages (\d+)/.exec(prompt)?.[1] ?? 1);
    const make = beats[id];
    if (!make) throw new Error(`the test model has no beat "${id}"`);
    return JSON.stringify(make(langOf(prompt), page));
  }
  if (name.startsWith('translate')) {
    const input = jsonAfter(prompt, /\(key: text\):\n/);
    const toArabic = /Arabic/.test(/^Translate from .*? to (.*?)\. Lesson/m.exec(prompt)?.[1] ?? '');
    // marks ([[b]]) and math ($…$) stay as they are; the script check of the target language passes
    const say = (v: string) => (toArabic ? `ع ${v}` : v.replace(/[؀-ۿ]+/g, 'x'));
    return JSON.stringify(Object.fromEntries(Object.entries(input).map(([k, v]) => [k, say(v)])));
  }
  if (name === 'text') return 'Integers\n\nTo subtract a number, add its opposite.';
  if (name.startsWith('judge')) return '[]';
  throw new Error(`the test model cannot answer "${name}"`);
};
