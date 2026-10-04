// Teacher panel: rate each step of a lesson on five criteria, rate the whole lesson, and download the ratings
// as a file to send back. Works offline (ratings stay in this browser until downloaded). Enabled by the export
// (`warqa panel kit`) or by adding ?panel to a lesson's address.
import type { MessageKey, Params } from '@warqa/i18n';
import { h } from './dom.js';

export const CRITERIA = ['accuracy', 'clarity', 'picture', 'language', 'level'] as const;
export type Criterion = (typeof CRITERIA)[number];

export interface StepRating extends Partial<Record<Criterion, number>> {
  note?: string;
}
export interface LessonRating {
  lang: string;
  beats: Record<string, StepRating>;
  overall?: { use?: 'yes' | 'changes' | 'no'; score?: number; note?: string };
}
export interface Ratings {
  schema: 'warqa.ratings/1';
  kit: string;
  rater: { name?: string; at: string };
  lessons: Record<string, LessonRating>;
}

export interface PanelConfig {
  /** Kit id: ratings of one kit are kept together. */
  kit: string;
  /** Code of this lesson in the kit (blind kits hide which model made it). */
  code: string;
}

type T = (key: MessageKey, params?: Params) => string;

const key = (kit: string) => `warqa:panel:${kit}`;

export function loadRatings(kit: string): Ratings {
  try {
    const v = JSON.parse(localStorage.getItem(key(kit)) ?? 'null') as Ratings | null;
    if (v?.schema === 'warqa.ratings/1') return v;
  } catch {
    /* private mode or corrupt data: start fresh */
  }
  return { schema: 'warqa.ratings/1', kit, rater: { at: new Date().toISOString() }, lessons: {} };
}

function saveRatings(r: Ratings): void {
  r.rater.at = new Date().toISOString();
  try {
    localStorage.setItem(key(r.kit), JSON.stringify(r));
  } catch {
    /* storage unavailable: the download button still has the data of this session */
  }
}

/** A row of 1–5 choices (radio buttons) for one criterion. */
function scale(name: string, label: string, value: number | undefined, onPick: (v: number) => void): HTMLElement {
  return h(
    'fieldset',
    { class: 'wq-panel-scale' },
    h('legend', {}, label),
    ...[1, 2, 3, 4, 5].map((n) =>
      h(
        'label',
        { class: 'wq-panel-pt' },
        h('input', {
          type: 'radio',
          name,
          value: String(n),
          checked: value === n,
          onchange: () => onPick(n),
        }),
        h('span', {}, String(n)),
      ),
    ),
  );
}

export class RatingPanel {
  readonly el: HTMLDialogElement;
  private ratings: Ratings;

  constructor(
    private cfg: PanelConfig,
    private t: T,
    private current: () => { id: string; title: string; lang: string },
  ) {
    this.el = h('dialog', { class: 'wq-panel', 'aria-label': t('panel.title') }) as HTMLDialogElement;
    this.ratings = loadRatings(cfg.kit);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.el.close();
    });
  }

  get open(): boolean {
    return this.el.open;
  }

  toggle(): void {
    if (this.el.open) this.el.close();
    else {
      this.render();
      this.el.showModal();
    }
  }

  private lesson(lang: string): LessonRating {
    const l = (this.ratings.lessons[this.cfg.code] ??= { lang, beats: {} });
    l.lang = lang;
    return l;
  }

  private render(): void {
    const t = this.t;
    const beat = this.current();
    const lesson = this.lesson(beat.lang);
    const step: StepRating = { ...(lesson.beats[beat.id] ?? {}) };
    const overall = { ...(lesson.overall ?? {}) };
    const status = h('p', { class: 'wq-panel-status', role: 'status' });
    const rated = () =>
      Object.values(this.ratings.lessons).reduce(
        (n, l) => n + Object.values(l.beats).filter((b) => CRITERIA.some((c) => b[c])).length,
        0,
      );
    const save = () => {
      const cleanStep = Object.fromEntries(Object.entries(step).filter(([, v]) => v !== undefined && v !== ''));
      if (Object.keys(cleanStep).length) lesson.beats[beat.id] = cleanStep as StepRating;
      lesson.overall = overall;
      saveRatings(this.ratings);
      status.textContent = `${t('panel.saved')} ${t('panel.count', { n: rated() })}`;
    };
    const name = h('input', {
      type: 'text',
      class: 'wq-panel-name',
      value: this.ratings.rater.name ?? '',
      'aria-label': t('panel.name'),
      placeholder: t('panel.name'),
      oninput: (e: Event) => {
        this.ratings.rater.name = (e.target as HTMLInputElement).value.trim() || undefined;
      },
    });
    const note = h('textarea', {
      class: 'wq-panel-note',
      rows: 2,
      'aria-label': t('panel.note'),
      placeholder: t('panel.note'),
      oninput: (e: Event) => {
        step.note = (e.target as HTMLTextAreaElement).value;
      },
    }) as HTMLTextAreaElement;
    note.value = step.note ?? '';
    const use = h(
      'fieldset',
      { class: 'wq-panel-use' },
      h('legend', {}, t('panel.use')),
      ...(['yes', 'changes', 'no'] as const).map((v) =>
        h(
          'label',
          {},
          h('input', {
            type: 'radio',
            name: 'wq-use',
            value: v,
            checked: overall.use === v,
            onchange: () => (overall.use = v),
          }),
          h('span', {}, t(v === 'yes' ? 'panel.useYes' : v === 'changes' ? 'panel.useChanges' : 'panel.useNo')),
        ),
      ),
    );
    this.el.replaceChildren(
      h(
        'form',
        {
          class: 'wq-panel-box',
          method: 'dialog',
          onsubmit: (e: Event) => {
            e.preventDefault();
            save();
            this.el.close();
          },
        },
        h('h2', {}, t('panel.title')),
        h('h3', {}, t('panel.step', { title: beat.title })),
        h('p', { class: 'wq-panel-intro' }, t('panel.intro')),
        ...CRITERIA.map((c) =>
          scale(`wq-${c}`, t(`panel.${c}` as MessageKey), step[c], (v) => {
            step[c] = v;
          }),
        ),
        note,
        h('h3', {}, t('panel.lesson')),
        use,
        scale('wq-overall', t('panel.overall'), overall.score, (v) => (overall.score = v)),
        name,
        status,
        h(
          'div',
          { class: 'wq-panel-actions' },
          h('button', { type: 'submit', class: 'wq-btn wq-primary' }, t('panel.save')),
          h(
            'button',
            {
              type: 'button',
              class: 'wq-btn',
              onclick: () => {
                save();
                this.download();
              },
            },
            t('panel.download'),
          ),
        ),
      ),
    );
    status.textContent = t('panel.count', { n: rated() });
  }

  /** Save the ratings of this kit as a JSON file. */
  download(): void {
    const blob = new Blob([`${JSON.stringify(this.ratings, null, 2)}\n`], { type: 'application/json' });
    const a = h('a', {
      href: URL.createObjectURL(blob),
      download: `warqa-ratings-${this.cfg.kit}-${(this.ratings.rater.name ?? 'teacher').replace(/[^\p{L}\p{N}]+/gu, '-')}.json`,
    }) as HTMLAnchorElement;
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }
}
