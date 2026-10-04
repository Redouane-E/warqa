// Question cards: one card per question beat, questions in sequence, keyboard first.
// Portions derived from Papermorph (MIT): quick-check / practice card flow, first-try scoring, "Show answer",
// per-row marking and the keyboard scheme.
import type { MessageKey, Params } from '@warqa/i18n';
import { normalizeDigits } from '@warqa/i18n';
import { answerText, type Grade, grade, gradeRow, partsOf, type Response, shuffleIds } from '../core/grade.js';
import { parseTemplate, templateGroups } from '../core/text.js';
import type { Question } from '../schema/question.js';
import { h, rich } from './dom.js';
import type { Box } from './views/types.js';

export interface Score {
  right: number;
  total: number;
  kind: 'check' | 'practice';
}

export interface QuizApi {
  lang: string;
  dir: 'ltr' | 'rtl';
  t(key: MessageKey, params?: Params): string;
  fmt(n: number): string;
  /** First-try score (kept across revisits). */
  score(qid: string): Score | undefined;
  record(qid: string, s: Score): void;
  /** Play a question's resolve cues on the picture. */
  resolve(qid: string): void;
  /** Stage box of a part of a node (for pick questions). */
  partBox(node: string, sub: string): Box | null;
  pickables(node: string): string[];
  /** Stage overlay for hit targets. */
  overlay: HTMLElement;
  done(): void;
}

interface Builder {
  el: HTMLElement;
  response(): Response | null;
  /** Show per-part marks after grading. */
  mark?(g: Grade): void;
  reveal(): void;
  focus(): void;
  key?(e: KeyboardEvent): boolean;
  hint?: string;
  lock(): void;
  destroy?(): void;
}

let uid = 0;
const nextId = (p: string) => `wq-${p}-${++uid}`;

export interface CardOptions {
  place: 'band' | 'side' | 'top' | 'screen';
  label: string;
  kind: 'check' | 'practice';
}

export interface CardController {
  el: HTMLElement;
  key(e: KeyboardEvent): boolean;
  /** Show the answer of the current question (videos, demos). */
  reveal?(): void;
  destroy(): void;
}

/** Open a card with a beat's questions. */
export function openCard(host: HTMLElement, questions: Question[], opts: CardOptions, api: QuizApi): CardController {
  const card = h('section', { class: `wq-card wq-card-${opts.place}`, role: 'region', 'aria-label': opts.label });
  const head = h('div', { class: 'wq-card-head' }, h('span', { class: 'wq-card-label' }, opts.label));
  const counter = h('span', { class: 'wq-card-count' });
  head.append(counter);
  const promptEl = h('div', { class: 'wq-prompt' });
  const body = h('div', { class: 'wq-qbody' });
  const fb = h('div', { class: 'wq-fb', role: 'status', 'aria-live': 'polite' });
  const keys = h('p', { class: 'wq-keys' });
  const actions = h('div', { class: 'wq-actions' });
  card.append(head, promptEl, body, fb, keys, actions);
  host.append(card);
  let qi = 0;
  let b: Builder | null = null;
  let state: 'answering' | 'resolved' = 'answering';
  let tries = 0;

  const btn = (key: MessageKey, cls: string, fn: () => void, shortcut?: string) =>
    h('button', { class: `wq-btn ${cls}`, type: 'button', onclick: fn, 'aria-keyshortcuts': shortcut }, api.t(key));

  function showQuestion(i: number) {
    b?.destroy?.();
    qi = i;
    state = 'answering';
    tries = 0;
    const q = questions[i]!;
    counter.textContent = questions.length > 1 ? api.t('quiz.progress', { k: i + 1, n: questions.length }) : '';
    promptEl.replaceChildren(rich(q.prompt));
    promptEl.id = nextId('prompt');
    b = build(q, api, promptEl.id);
    body.replaceChildren(b.el);
    fb.replaceChildren();
    fb.className = 'wq-fb';
    keys.textContent = b.hint ?? '';
    const prev = api.score(q.id);
    renderActions();
    if (prev) {
      // revisiting: keep the first-try score, let the reader try again
      tries = 1;
      renderActions();
    }
    requestAnimationFrame(() => b?.focus());
  }

  function renderActions() {
    actions.replaceChildren();
    if (state === 'answering') {
      actions.append(btn('quiz.check', 'wq-primary', check, 'Enter'));
      if (tries > 0) actions.append(btn('quiz.show', '', showAnswer, 'S'));
    } else {
      const last = qi === questions.length - 1;
      const next = btn(last ? 'quiz.continue' : 'quiz.next', 'wq-primary', advance, 'Enter');
      actions.append(next);
      requestAnimationFrame(() => next.focus());
    }
  }

  function feedback(ok: boolean | 'answer', text: string | undefined, extra?: string) {
    fb.className = `wq-fb ${ok === true ? 'wq-ok' : ok === 'answer' ? 'wq-answer' : 'wq-no'}`;
    const lead = ok === true ? api.t('quiz.correct') : ok === 'answer' ? api.t('quiz.answer') : api.t('quiz.notQuite');
    fb.replaceChildren(h('strong', {}, lead), ' ', extra ? `${extra} ` : '', text ? rich(text) : '');
  }

  function check() {
    if (!b || state !== 'answering') return;
    const q = questions[qi]!;
    const r = b.response();
    if (!r) {
      fb.className = 'wq-fb wq-no';
      fb.textContent =
        q.kind === 'choice' || q.kind === 'pick' || q.kind === 'order'
          ? api.t('quiz.chooseFirst')
          : api.t('quiz.fillAll');
      return;
    }
    const g = grade(q, r, api.lang);
    if (!api.score(q.id)) api.record(q.id, { right: g.right, total: g.total, kind: opts.kind });
    tries++;
    b.mark?.(g);
    if (g.ok) {
      state = 'resolved';
      b.lock();
      feedback(true, q.explain);
      api.resolve(q.id);
    } else {
      let msg = g.message ?? q.hint;
      let extra: string | undefined;
      if (q.kind === 'blanks' && q.rows.length > 1) extra = api.t('quiz.rowsRight', { k: g.right, n: g.total });
      if (q.kind === 'blanks' || q.kind === 'numeric') {
        const details =
          (q.kind === 'blanks'
            ? (g.detail as { boxes: Record<string, string> }[])
            : [{ boxes: { v: g.detail as string } }]) ?? [];
        const verdicts = details.flatMap((d) => Object.values(d.boxes));
        if (verdicts.includes('nan')) msg = api.t('quiz.notNumber');
        else if (verdicts.includes('lowest')) msg = api.t('quiz.lowest');
        else if (q.kind === 'blanks' && q.rows.length === 1) msg = q.rows[0]!.hint ?? msg;
      }
      feedback(false, msg, extra);
    }
    renderActions();
  }

  function showAnswer() {
    if (!b || state !== 'answering') return;
    const q = questions[qi]!;
    b.reveal();
    b.lock();
    state = 'resolved';
    feedback('answer', q.explain ?? '');
    api.resolve(q.id);
    renderActions();
  }

  function advance() {
    if (qi < questions.length - 1) showQuestion(qi + 1);
    else api.done();
  }

  showQuestion(0);

  return {
    el: card,
    key(e) {
      const inInput = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        // Enter means "check / continue" everywhere in the card, except on the card's other action buttons
        // (e.g. "Show answer"), which keep their normal activation.
        const tgt = e.target as HTMLElement;
        if (tgt?.classList?.contains('wq-btn') && !tgt.classList.contains('wq-primary') && card.contains(tgt))
          return false;
        e.preventDefault();
        if (state === 'answering') check();
        else advance();
        return true;
      }
      if (inInput && e.code === 'Escape') {
        (e.target as HTMLElement).blur();
        card.focus();
        return true;
      }
      if (inInput) return false;
      if (b?.key?.(e)) return true;
      if (e.code === 'KeyS' && state === 'answering' && tries > 0) {
        showAnswer();
        return true;
      }
      return false;
    },
    reveal() {
      if (state === 'answering') showAnswer();
    },
    destroy() {
      b?.destroy?.();
      card.remove();
    },
  };
}

/* ---------- question builders ---------- */

function build(q: Question, api: QuizApi, labelledBy: string): Builder {
  switch (q.kind) {
    case 'choice':
      return choiceB(q, api, labelledBy);
    case 'blanks':
      return blanksB(q, api);
    case 'numeric':
      return blanksB(
        {
          ...q,
          kind: 'blanks',
          rows: [{ template: `[[v]]${q.unit ? ` ${q.unit}` : ''}`, answers: { v: q.answer }, anyOrder: false }],
        },
        api,
      );
    case 'grid':
      return gridB(q, api);
    case 'order':
      return orderB(q, api);
    case 'pick':
      return pickB(q, api);
    case 'text':
      return textB(q, api);
  }
}

function choiceB(q: Extract<Question, { kind: 'choice' }>, api: QuizApi, labelledBy: string): Builder {
  const sel = new Set<string>();
  const list = h('div', { class: 'wq-choices', role: q.multi ? 'group' : 'radiogroup', 'aria-labelledby': labelledBy });
  const btns = q.options.map((o, i) => {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'wq-choice',
        role: q.multi ? 'checkbox' : 'radio',
        'aria-checked': 'false',
        'data-id': o.id,
      },
      h('span', { class: 'wq-choice-k', 'aria-hidden': 'true' }, api.fmt(i + 1)),
      rich(o.text),
    );
    b.addEventListener('click', () => toggle(o.id));
    list.append(b);
    return b;
  });
  let locked = false;
  function toggle(id: string) {
    if (locked) return;
    if (!q.multi) sel.clear();
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    btns.forEach((b) => {
      const on = sel.has(b.dataset.id!);
      b.classList.toggle('wq-on', on);
      b.setAttribute('aria-checked', String(on));
      b.classList.remove('wq-right', 'wq-wrong');
    });
  }
  return {
    el: list,
    hint: `${api.t('quiz.keys')} 1–${api.fmt(q.options.length)} · Enter`,
    response: () => (sel.size ? { kind: 'choice', selected: [...sel] } : null),
    mark(g) {
      btns.forEach((b) => {
        const id = b.dataset.id!;
        if (sel.has(id)) b.classList.add(q.correct.includes(id) ? 'wq-right' : 'wq-wrong');
      });
      void g;
    },
    reveal() {
      sel.clear();
      q.correct.forEach((c) => sel.add(c));
      btns.forEach((b) => {
        b.classList.toggle('wq-on', sel.has(b.dataset.id!));
        b.classList.toggle('wq-right', sel.has(b.dataset.id!));
        b.classList.remove('wq-wrong');
      });
    },
    focus: () => btns[0]?.focus(),
    key(e) {
      const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
      if (m) {
        const o = q.options[Number(m[2]) - 1];
        if (o) {
          toggle(o.id);
          btns[Number(m[2]) - 1]!.focus();
          return true;
        }
      }
      return false;
    },
    lock() {
      locked = true;
    },
  };
}

function blanksB(q: Extract<Question, { kind: 'blanks' }>, api: QuizApi): Builder {
  const wrap = h('div', { class: `wq-rows ${q.rows.length > 3 ? 'wq-rows-grid' : ''}` });
  const inputs: Record<string, HTMLInputElement>[] = [];
  const marks: HTMLElement[] = [];
  let n = 0;
  q.rows.forEach((row, ri) => {
    const line = h('div', { class: 'wq-row' });
    const boxes: Record<string, HTMLInputElement> = {};
    for (const g of templateGroups(parseTemplate(row.template))) {
      const span = h(
        g.math ? 'bdi' : 'span',
        g.math ? { class: 'wq-math wq-mathrow', dir: 'ltr' } : { class: 'wq-rowtext' },
      );
      for (const p of g.parts) {
        if ('box' in p) {
          const inp = h('input', {
            class: 'wq-box',
            inputmode: 'decimal',
            autocomplete: 'off',
            spellcheck: 'false',
            'aria-label': api.t('quiz.answerBox', { i: ++n }),
            dir: 'ltr',
          });
          boxes[p.box] = inp;
          span.append(inp);
        } else span.append(p.math ? h('span', {}, rich(`$${p.text.replace(/\$/g, '')}$`)) : p.text);
      }
      line.append(span);
    }
    const mk = h('span', { class: 'wq-rowmark', 'aria-hidden': 'true' });
    line.append(mk);
    marks.push(mk);
    if (row.explain) line.title = '';
    inputs.push(boxes);
    wrap.append(line);
    void ri;
  });
  const all = () => inputs.flatMap((r) => Object.values(r));
  return {
    el: wrap,
    hint: `${api.t('quiz.keys')} Tab · Enter · Esc`,
    response() {
      const rows = inputs.map((r) =>
        Object.fromEntries(Object.entries(r).map(([k, el]) => [k, normalizeDigits(el.value)])),
      );
      if (rows.every((r) => Object.values(r).every((v) => !v.trim()))) return null;
      return { kind: 'blanks', rows };
    },
    mark() {
      q.rows.forEach((row, i) => {
        const res = gradeRow(
          row,
          Object.fromEntries(Object.entries(inputs[i]!).map(([k, el]) => [k, el.value])),
          api.lang,
        );
        for (const [k, el] of Object.entries(inputs[i]!)) {
          el.classList.toggle('wq-right', res.boxes[k] === 'ok');
          el.classList.toggle('wq-wrong', res.boxes[k] !== 'ok');
          el.setAttribute('aria-invalid', String(res.boxes[k] !== 'ok'));
        }
        marks[i]!.textContent = res.ok ? '✓' : '✗';
        marks[i]!.className = `wq-rowmark ${res.ok ? 'wq-ok' : 'wq-no'}`;
        if (!res.ok && row.explain === undefined) marks[i]!.title = '';
      });
    },
    reveal() {
      q.rows.forEach((row, i) => {
        for (const [k, el] of Object.entries(inputs[i]!)) {
          el.value = answerText(row.answers[k]!);
          el.classList.add('wq-right');
          el.classList.remove('wq-wrong');
        }
        marks[i]!.textContent = '✓';
        marks[i]!.className = 'wq-rowmark wq-ok';
      });
    },
    focus: () =>
      all()
        .find((el) => !el.classList.contains('wq-right'))
        ?.focus(),
    lock() {
      all().forEach((el) => (el.readOnly = true));
    },
  };
}

function gridB(q: Extract<Question, { kind: 'grid' }>, api: QuizApi): Builder {
  const cols =
    q.cols === 'tf'
      ? [
          { id: 't', text: api.t('quiz.true') },
          { id: 'f', text: api.t('quiz.false') },
        ]
      : q.cols;
  const sel: Record<string, string[]> = {};
  const table = h('div', { class: 'wq-grid', role: 'table' });
  const rowsEls: HTMLElement[] = [];
  const btn: Record<string, HTMLButtonElement[]> = {};
  let cur = 0;
  let locked = false;
  q.rows.forEach((r, ri) => {
    const cells = cols.map((c, ci) => {
      const b = h(
        'button',
        { type: 'button', class: 'wq-gcell', 'aria-pressed': 'false', 'data-c': c.id },
        rich(c.text),
      );
      b.addEventListener('click', () => {
        cur = ri;
        set(r.id, c.id);
      });
      void ci;
      return b;
    });
    btn[r.id] = cells;
    const mk = h('span', { class: 'wq-rowmark', 'aria-hidden': 'true' });
    const row = h(
      'div',
      { class: 'wq-grow', role: 'row' },
      h('div', { class: 'wq-gtext', role: 'cell' }, rich(r.text)),
      h('div', { class: 'wq-gbtns', role: 'cell' }, cells),
      mk,
    );
    rowsEls.push(row);
    table.append(row);
  });
  function set(rowId: string, c: string) {
    if (locked) return;
    sel[rowId] = [c];
    btn[rowId]!.forEach((b) => {
      const on = b.dataset.c === c;
      b.classList.toggle('wq-on', on);
      b.setAttribute('aria-pressed', String(on));
      b.classList.remove('wq-right', 'wq-wrong');
    });
    rowsEls.forEach((r, i) => r.classList.toggle('wq-cur', i === cur));
  }
  const keyFor = (c: { id: string }, i: number) =>
    q.cols === 'tf' ? (c.id === 't' ? 'KeyT' : 'KeyF') : `Digit${i + 1}`;
  return {
    el: table,
    hint: `${api.t('quiz.keys')} ${q.cols === 'tf' ? 'T / F' : `1–${api.fmt(cols.length)}`} · ↑ ↓ · Enter`,
    response: () => (q.rows.every((r) => sel[r.id]?.length) ? { kind: 'grid', rows: sel } : null),
    mark(g) {
      const per = g.detail as boolean[];
      q.rows.forEach((r, i) => {
        btn[r.id]!.forEach((b) => {
          if (b.classList.contains('wq-on')) b.classList.add(per[i] ? 'wq-right' : 'wq-wrong');
        });
        const mk = rowsEls[i]!.querySelector('.wq-rowmark')!;
        mk.textContent = per[i] ? '✓' : '✗';
        mk.className = `wq-rowmark ${per[i] ? 'wq-ok' : 'wq-no'}`;
        if (!per[i] && r.why) rowsEls[i]!.querySelector('.wq-gtext')!.setAttribute('title', r.why);
      });
    },
    reveal() {
      q.rows.forEach((r, i) => {
        const want = ([] as string[]).concat(r.correct);
        cur = i;
        set(r.id, want[0]!);
        btn[r.id]!.forEach((b) => b.classList.toggle('wq-right', want.includes(b.dataset.c!)));
        const why = r.why ? rowsEls[i]!.querySelector('.wq-gtext') : null;
        if (why && !why.querySelector('.wq-why')) why.append(h('span', { class: 'wq-why' }, ' — ', rich(r.why!)));
      });
    },
    focus: () => btn[q.rows[0]!.id]?.[0]?.focus(),
    key(e) {
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        cur = Math.max(0, Math.min(q.rows.length - 1, cur + (e.code === 'ArrowDown' ? 1 : -1)));
        rowsEls.forEach((r, i) => r.classList.toggle('wq-cur', i === cur));
        btn[q.rows[cur]!.id]![0]!.focus();
        return true;
      }
      const ci = cols.findIndex((c, i) => keyFor(c, i) === e.code);
      if (ci >= 0) {
        const r = q.rows[cur]!;
        set(r.id, cols[ci]!.id);
        btn[r.id]![ci]!.focus();
        if (cur < q.rows.length - 1) {
          cur++;
          rowsEls.forEach((row, i) => row.classList.toggle('wq-cur', i === cur));
        }
        return true;
      }
      return false;
    },
    lock() {
      locked = true;
    },
  };
}

function orderB(q: Extract<Question, { kind: 'order' }>, api: QuizApi): Builder {
  let ids = shuffleIds(
    q.items.map((i) => i.id),
    q.id,
  );
  let cur = 0;
  let locked = false;
  const list = h('ol', { class: 'wq-order', 'aria-describedby': '' });
  const text = new Map(q.items.map((i) => [i.id, i.text]));
  function render() {
    list.replaceChildren(
      ...ids.map((id, i) =>
        h(
          'li',
          { class: `wq-oitem ${i === cur ? 'wq-cur' : ''}`, 'data-id': id },
          h('span', { class: 'wq-on-n', 'aria-hidden': 'true' }, api.fmt(i + 1)),
          h('span', { class: 'wq-otext' }, rich(text.get(id)!)),
          h(
            'button',
            {
              type: 'button',
              class: 'wq-omove',
              'aria-label': `${api.t('quiz.moveUp')}: ${text.get(id)}`,
              onclick: () => move(i, -1),
              disabled: locked || i === 0,
            },
            '↑',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'wq-omove',
              'aria-label': `${api.t('quiz.moveDown')}: ${text.get(id)}`,
              onclick: () => move(i, 1),
              disabled: locked || i === ids.length - 1,
            },
            '↓',
          ),
        ),
      ),
    );
  }
  function move(i: number, d: number) {
    if (locked) return;
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    cur = j;
    render();
    (
      list.children[j]?.querySelector(`.wq-omove:${d < 0 ? 'first-of-type' : 'last-of-type'}`) as HTMLElement | null
    )?.focus();
  }
  render();
  return {
    el: list,
    hint: api.t('quiz.orderHint'),
    response: () => ({ kind: 'order', ids }),
    mark(g) {
      const per = g.detail as boolean[];
      [...list.children].forEach((li, i) => li.classList.add(per[i] ? 'wq-right' : 'wq-wrong'));
    },
    reveal() {
      ids = q.items.map((i) => i.id);
      locked = true;
      render();
      [...list.children].forEach((li) => li.classList.add('wq-right'));
    },
    focus: () => (list.querySelector('.wq-omove:not([disabled])') as HTMLElement | null)?.focus(),
    key(e) {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        if (e.altKey || e.shiftKey) move(cur, e.code === 'ArrowUp' ? -1 : 1);
        else {
          cur = Math.max(0, Math.min(ids.length - 1, cur + (e.code === 'ArrowUp' ? -1 : 1)));
          render();
        }
        return true;
      }
      return false;
    },
    lock() {
      locked = true;
      render();
    },
  };
}

function pickB(q: Extract<Question, { kind: 'pick' }>, api: QuizApi): Builder {
  const choices = q.choices ?? api.pickables(q.on);
  let sel: string | null = null;
  let cur = 0;
  let locked = false;
  const layer = h('div', { class: 'wq-picks', role: 'radiogroup', 'aria-label': q.prompt.replace(/\$/g, '') });
  api.overlay.append(layer);
  const label = (s: string) => {
    const m = /^(?:tick|pt):(.+)$/.exec(s);
    return m ? m[1]! : s.replace(/^\w+:/, '');
  };
  const btns = choices.map((s, i) => {
    const box = api.partBox(q.on, s);
    const b = h('button', {
      type: 'button',
      class: 'wq-pick',
      role: 'radio',
      'aria-checked': 'false',
      'aria-label': label(s),
      'data-s': s,
      tabindex: i === 0 ? '0' : '-1',
    });
    if (box)
      Object.assign(b.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    else b.hidden = true;
    b.addEventListener('click', () => choose(i));
    layer.append(b);
    return b;
  });
  const status = h('p', { class: 'wq-pickstatus' }, api.t('quiz.pickHint'));
  function choose(i: number) {
    if (locked) return;
    cur = i;
    sel = choices[i]!;
    btns.forEach((b, j) => {
      b.classList.toggle('wq-on', j === i);
      b.setAttribute('aria-checked', String(j === i));
      b.tabIndex = j === i ? 0 : -1;
      b.classList.remove('wq-right', 'wq-wrong');
    });
    btns[i]!.focus();
    status.textContent = api.t('quiz.selected', { label: label(sel) });
  }
  return {
    el: status,
    hint: `${api.t('quiz.keys')} ← → · Enter`,
    response: () => (sel ? { kind: 'pick', sub: sel } : null),
    mark(g) {
      const b = btns[cur];
      b?.classList.add(g.ok ? 'wq-right' : 'wq-wrong');
    },
    reveal() {
      const i = choices.indexOf(q.correct[0]!);
      if (i >= 0) choose(i);
      btns[i]?.classList.add('wq-right');
    },
    focus: () => btns.find((b) => !b.hidden)?.focus(),
    key(e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        // pick targets follow the picture's geometry (number lines stay left-to-right)
        const d = e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 1;
        choose(Math.max(0, Math.min(choices.length - 1, (sel ? cur : d > 0 ? -1 : choices.length) + d)));
        return true;
      }
      return false;
    },
    lock() {
      locked = true;
    },
    destroy: () => layer.remove(),
  };
}

function textB(q: Extract<Question, { kind: 'text' }>, api: QuizApi): Builder {
  const inp = h('input', {
    class: 'wq-box wq-textbox',
    autocomplete: 'off',
    'aria-label': api.t('quiz.answerBox', { i: 1 }),
    dir: 'auto',
  });
  return {
    el: h('div', { class: 'wq-row' }, inp),
    hint: `${api.t('quiz.keys')} Enter · Esc`,
    response: () => (inp.value.trim() ? { kind: 'text', value: inp.value } : null),
    mark(g) {
      inp.classList.toggle('wq-right', g.ok);
      inp.classList.toggle('wq-wrong', !g.ok);
    },
    reveal() {
      inp.value = q.accept[0]!;
      inp.classList.add('wq-right');
    },
    focus: () => inp.focus(),
    lock() {
      inp.readOnly = true;
    },
  };
}

export { partsOf };
