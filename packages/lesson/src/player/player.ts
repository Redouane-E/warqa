// The lesson player: clock, audio, beats, questions, captions, transcript, keyboard and progress.
// Portions derived from Papermorph (MIT): the player model (beats, audio-driven clock, segments bar, cover,
// help overlay, finish card, "?beat=&t=" review frames, sound-failure fallback).
import {
  dirOf,
  formatNumber,
  LANG_INFO,
  langInfo,
  type MessageKey,
  type Params,
  splitSentences,
  splitWords,
  translator,
} from '@warqa/i18n';
import { componentDef } from '../components/registry.js';
import { type CompiledBeat, type CompiledLesson, compileLesson, sampler } from '../core/compile.js';
import { localize } from '../core/strings.js';
import { narrationText, spokenText, wordAt } from '../core/timing.js';
import type { Segment } from '../core/types.js';
import { key as segKey } from '../core/types.js';
import { type Lesson, type LessonInput, parseLesson, type Strings, type Timings } from '../schema/lesson.js';
import { h, svg } from './dom.js';
import { type PanelConfig, RatingPanel } from './panel.js';
import { type CardController, openCard, type Score } from './quiz.js';
import { type CardPlace, SceneRenderer } from './scene.js';

export interface PlayerData {
  /** The lesson skeleton (author language). */
  lesson: LessonInput | Lesson;
  /** Languages offered (default: the lesson language plus those with strings). */
  langs?: string[];
  lang?: string;
  strings?: Record<string, Strings>;
  timings?: Record<string, Timings>;
  /** Audio URLs per language and beat id. */
  audio?: Record<string, Record<string, string>>;
  book?: {
    id: string;
    title?: string;
    digits?: 'latn' | 'arab';
    /** Links (relative to the page): contents, next and previous lessons. */
    home?: string;
    next?: string;
    prev?: string;
  };
  /** Base URL for lesson assets (images). */
  assetsBase?: string;
  /** Typeset math: TeX source → SVG markup (made at export for "math" nodes). */
  math?: Record<string, string>;
  /** Teacher panel: show the rating dialog (also with ?panel in the address). */
  panel?: PanelConfig;
}

export interface PlayerOptions {
  /** Listen for keys on the whole window (standalone pages) or only when the player has focus. */
  keyboard?: 'global' | 'local';
  autoplay?: boolean;
  /** Freeze at a beat and time (review screenshots). */
  review?: { beat: number; t: number };
  /** Save progress and scores in localStorage. */
  storage?: boolean;
  onEvent?: (e: PlayerEvent) => void;
}

export type PlayerEvent =
  | { type: 'beat'; index: number; id: string }
  | { type: 'answer'; qid: string; score: Score }
  | { type: 'finish'; right: number; total: number }
  | { type: 'lang'; lang: string };

const CAPTIONS_KEY = 'warqa:captions';

export class Player {
  readonly root: HTMLElement;
  private frame!: HTMLElement;
  private stage!: SVGSVGElement;
  private scene!: SVGGElement;
  private htmlLayer!: HTMLDivElement;
  private overlay!: HTMLDivElement;
  private cardHost!: HTMLDivElement;
  private captionEl!: HTMLDivElement;
  private pausedEl!: HTMLDivElement;
  private soundNote!: HTMLParagraphElement;
  private cover!: HTMLButtonElement;
  private helpEl!: HTMLDialogElement;
  private panel: RatingPanel | null = null;
  private transcriptEl!: HTMLElement;
  private bar!: HTMLElement;
  private segsEl!: HTMLElement;
  private stepName!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private live!: HTMLDivElement;

  private skeleton: Lesson;
  lesson!: Lesson;
  compiled!: CompiledLesson;
  lang: string;
  dir: 'ltr' | 'rtl' = 'ltr';
  private t: (k: MessageKey, p?: Params) => string = (k) => k;
  private renderer!: SceneRenderer;

  i = 0;
  time = 0;
  playing = false;
  private started = false;
  private audio: HTMLAudioElement | null = null;
  private audioFailed = false;
  private audioStartedAt = 0;
  private lastNow = 0;
  private raf = 0;
  private extra = new Map<string, Segment[]>();
  private card: CardController | null = null;
  private cardShown = false;
  private finished = false;
  scores: Record<string, Score> = {};
  private captionsOn = false;
  /** Caption being shown (beat:sentence) and its word spans, for the word-by-word highlight. */
  private capKey = '';
  private capWords: { k: number; el: HTMLElement }[] = [];
  private capLit: HTMLElement | undefined;
  private reducedMotion = false;
  private destroyed = false;
  private reviewMode = false;
  private builtIndex = -1;

  constructor(
    host: HTMLElement,
    private data: PlayerData,
    private opts: PlayerOptions = {},
  ) {
    const user = opts.onEvent;
    // every event is also a DOM event ("warqa:beat", "warqa:answer", "warqa:finish", "warqa:lang") for LMS wrappers and host pages
    this.opts = {
      ...opts,
      onEvent: (e) => {
        user?.(e);
        try {
          window.dispatchEvent(
            new CustomEvent(`warqa:${e.type}`, { detail: { ...e, lesson: this.skeleton?.id, book: data.book?.id } }),
          );
        } catch {
          /* no DOM events (tests) */
        }
      },
    };
    this.skeleton = parseLesson(data.lesson);
    const langs = this.langs();
    this.lang = data.lang && langs.includes(data.lang) ? data.lang : langs[0]!;
    this.root = h('div', { class: 'wq-player', tabindex: '-1' });
    host.append(this.root);
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      this.captionsOn = localStorage.getItem(CAPTIONS_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
    this.buildDom();
    this.applyLang(this.lang);
    this.loadScores();
    this.keyHandler = this.keyHandler.bind(this);
    (opts.keyboard === 'local' ? this.root : window).addEventListener('keydown', this.keyHandler as EventListener);
    this.fitObserver();
    if (opts.review) {
      this.reviewMode = true;
      this.started = true;
      this.cover.hidden = true;
      this.seek(Math.min(opts.review.beat, this.compiled.beats.length - 1), false);
      this.time = opts.review.t;
      this.render();
      this.maybeAsk();
    } else {
      this.seek(0, false);
      if (opts.autoplay) this.begin();
    }
  }

  /* ---------- language ---------- */

  langs(): string[] {
    const set = new Set<string>(this.data.langs ?? [this.skeleton.lang, ...Object.keys(this.data.strings ?? {})]);
    return [...set];
  }

  private applyLang(lang: string) {
    this.lang = lang;
    this.dir = dirOf(lang);
    const digits = this.data.book?.digits ?? 'latn';
    this.t = translator(lang, { digits });
    this.root.setAttribute('lang', lang);
    this.root.setAttribute('dir', this.dir);
    this.root.classList.toggle('wq-rtl', this.dir === 'rtl');
    this.lesson = lang === this.skeleton.lang ? this.skeleton : localize(this.skeleton, this.data.strings?.[lang]);
    this.compiled = compileLesson(this.lesson, this.data.timings?.[lang], { lang, strict: false });
    for (const issue of this.compiled.issues)
      if (issue.level === 'error') console.warn(`[warqa] ${issue.beat ?? ''}: ${issue.message}`);
    const env = {
      lang,
      dir: this.dir,
      fmt: (n: number) => formatNumber(n, lang, { digits }),
      math: (tex: string) => this.data.math?.[tex],
      asset: (p: string) => {
        // URLs pass through; book paths ("assets/…") resolve against the exported assets folder
        if (/^(?:[a-z]+:|\/)/i.test(p)) return p;
        const base = this.data.assetsBase ?? '';
        return base + (base.endsWith('assets/') && p.startsWith('assets/') ? p.slice(7) : p);
      },
    };
    if (this.renderer) this.renderer.setEnv(env);
    else this.renderer = new SceneRenderer(this.scene, this.htmlLayer, env);
    this.translateChrome();
    this.buildSegments();
    this.buildTranscript();
  }

  /** Switch language, keeping the place: the same beat, at the last mark passed. */
  setLang(lang: string): void {
    if (lang === this.lang || !this.langs().includes(lang)) return;
    const cb = this.compiled.beats[this.i]!;
    let mark: string | null = null;
    let best = -1;
    for (const [name, at] of Object.entries(cb.timing.marks))
      if (at <= this.time && at > best) [mark, best] = [name, at];
    const wasPlaying = this.playing;
    this.applyLang(lang);
    const nt = mark ? (this.compiled.beats[this.i]!.timing.marks[mark] ?? 0) : 0;
    this.seek(this.i, false);
    this.time = nt;
    this.render();
    if (wasPlaying) this.play();
    this.opts.onEvent?.({ type: 'lang', lang });
  }

  /* ---------- DOM ---------- */

  private buildDom() {
    const r = this.root;
    this.frame = h('div', { class: 'wq-frame' });
    this.stage = svg('svg', { class: 'wq-stage', viewBox: '0 0 1600 900', role: 'img' });
    const defs = svg('defs', {}, this.stage);
    const grain = svg('filter', { id: 'wq-grain', x: 0, y: 0, width: '100%', height: '100%' }, defs);
    svg('feTurbulence', { type: 'fractalNoise', baseFrequency: 0.85, numOctaves: 2, seed: 7 }, grain);
    svg('feColorMatrix', { values: '0 0 0 0 .92  0 0 0 0 .95  0 0 0 0 .9  0 0 0 .07 0' }, grain);
    const vig = svg('radialGradient', { id: 'wq-vignette', cx: 0.5, cy: 0.45, r: 0.75 }, defs);
    svg('stop', { offset: 0.6, 'stop-color': '#000', 'stop-opacity': 0 }, vig);
    svg('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': 0.35 }, vig);
    svg('rect', { width: 1600, height: 900, class: 'wq-board' }, this.stage);
    svg('rect', { width: 1600, height: 900, filter: 'url(#wq-grain)' }, this.stage);
    svg('rect', { width: 1600, height: 900, fill: 'url(#wq-vignette)' }, this.stage);
    this.scene = svg('g', { class: 'wq-scene' }, this.stage);
    this.htmlLayer = h('div', { class: 'wq-html' });
    this.overlay = h('div', { class: 'wq-overlay' });
    this.cardHost = h('div', { class: 'wq-cards' });
    this.captionEl = h('div', { class: 'wq-caption', hidden: true });
    this.pausedEl = h('div', { class: 'wq-paused', hidden: true }, h('div'));
    this.soundNote = h('p', { class: 'wq-soundnote', hidden: true, role: 'status' });
    this.live = h('div', { class: 'wq-sr', 'aria-live': 'polite' });
    this.cover = h('button', { class: 'wq-cover', type: 'button' });
    this.cover.addEventListener('click', () => this.begin());
    this.frame.append(
      this.stage,
      this.htmlLayer,
      this.overlay,
      this.cardHost,
      this.captionEl,
      this.pausedEl,
      this.soundNote,
      this.cover,
    );
    this.pausedEl.addEventListener('click', () => this.togglePlay());
    this.helpEl = h('dialog', { class: 'wq-help' }) as HTMLDialogElement;
    this.transcriptEl = h('aside', { class: 'wq-transcript', hidden: true });
    this.bar = h('div', { class: 'wq-bar' });
    r.append(h('div', { class: 'wq-viewport' }, this.frame), this.bar, this.transcriptEl, this.helpEl, this.live);
    const panel = this.panelConfig();
    if (panel) {
      this.panel = new RatingPanel(
        panel,
        (k, p) => this.t(k, p),
        () => {
          const cb = this.beat();
          return { id: cb.id, title: cb.beat.title, lang: this.lang };
        },
      );
      r.append(this.panel.el);
    }
  }

  private translateChrome() {
    const t = this.t;
    const b = this.lesson;
    this.stage.setAttribute('aria-label', t('lesson.aria'));
    (this.pausedEl.firstChild as HTMLElement).textContent = t('lesson.paused');
    this.soundNote.textContent = t('lesson.soundFailed');
    const mins = b.minutes ?? Math.max(1, Math.round(this.compiled.beats.reduce((a, c) => a + c.timing.dur, 0) / 60));
    this.cover.replaceChildren(
      h(
        'span',
        { class: 'wq-cover-in' },
        b.unit || b.number !== undefined
          ? h(
              'span',
              { class: 'wq-cover-k' },
              [b.unit, b.number !== undefined ? this.t('cover.meta', { n: b.number, min: mins }).split(' · ')[0] : '']
                .filter(Boolean)
                .join(' · '),
            )
          : null,
        h('span', { class: 'wq-cover-t' }, b.title),
        h('span', { class: 'wq-go' }, svgIcon('play'), t('cover.start')),
        h(
          'small',
          {},
          `${b.number !== undefined ? t('cover.meta', { n: b.number, min: mins }) : t('cover.metaNoChapter', { min: mins })} · ${t('cover.hint')}`,
        ),
      ),
    );
    this.cover.setAttribute('aria-label', `${t('cover.start')}: ${b.title}`);
    this.buildBar();
    this.buildHelp();
    this.setCaptions(this.captionsOn);
  }

  private buildBar() {
    const t = this.t;
    const btn = (
      cls: string,
      label: string,
      icon: string | Node,
      fn: () => void,
      extra: Record<string, unknown> = {},
    ) => {
      const b = h(
        'button',
        { class: `wq-icon ${cls}`, type: 'button', 'aria-label': label, title: label, ...extra },
        typeof icon === 'string' ? svgIcon(icon) : icon,
      );
      b.addEventListener('click', fn);
      return b;
    };
    const home = this.data.book?.home
      ? h(
          'a',
          { class: 'wq-icon', href: this.data.book.home, 'aria-label': t('bar.home'), title: t('bar.home') },
          svgIcon('grid'),
        )
      : null;
    this.playBtn = btn('wq-play', t('bar.play'), svgIcon(this.playing ? 'pause' : 'play'), () => this.togglePlay());
    this.segsEl = h('div', { class: 'wq-segs' });
    this.stepName = h('div', { class: 'wq-stepname', 'aria-live': 'off' });
    const langs = this.langs();
    const langSel =
      langs.length > 1
        ? h(
            'select',
            {
              class: 'wq-lang',
              'aria-label': t('bar.language'),
              title: t('bar.language'),
              onchange: (e: Event) => this.setLang((e.target as HTMLSelectElement).value),
            },
            langs.map((l) =>
              h(
                'option',
                { value: l, selected: l === this.lang },
                LANG_INFO[l as keyof typeof LANG_INFO]?.name ?? langInfo(l).name,
              ),
            ),
          )
        : null;
    this.bar.replaceChildren(
      ...([
        home,
        this.playBtn,
        btn('wq-back', t('bar.back'), 'back', () => this.prev()),
        btn('wq-next', t('bar.next'), 'next', () => this.next()),
        btn('', t('bar.restart'), 'restart', () => this.restart()),
        this.segsEl,
        this.stepName,
        langSel,
        btn('wq-txt', t('bar.transcript'), 'transcript', () => this.toggleTranscript(), {
          'aria-pressed': String(!this.transcriptEl.hidden),
        }),
        btn(
          'wq-cc',
          t('bar.captions'),
          h('span', { class: 'wq-cc-t' }, 'CC'),
          () => this.setCaptions(!this.captionsOn),
          { 'aria-pressed': String(this.captionsOn) },
        ),
        this.panel
          ? btn('wq-txt wq-rate', t('panel.rate'), h('span', { class: 'wq-cc-t' }, '★'), () => this.toggleRating())
          : null,
        btn('wq-txt', t('bar.help'), h('span', { class: 'wq-cc-t' }, '?'), () => this.toggleHelp()),
        btn('', t('bar.fullscreen'), 'full', () => this.toggleFull()),
      ].filter(Boolean) as Node[]),
    );
    this.buildSegments();
  }

  private buildSegments() {
    if (!this.segsEl || !this.compiled) return;
    const total = this.compiled.beats.reduce((a, b) => a + Math.max(b.timing.dur, 2), 0);
    this.segsEl.replaceChildren(
      ...this.compiled.beats.map((b, i) => {
        const s = h(
          'button',
          {
            class: 'wq-seg',
            type: 'button',
            style: { flexGrow: String(Math.max(b.timing.dur, 2) / total) },
            'aria-label': this.t('bar.goto', { i: i + 1, title: b.beat.title }),
            title: b.beat.title,
          },
          h('i'),
        );
        s.addEventListener('click', () => this.seek(i, true));
        return s;
      }),
    );
  }

  private buildHelp() {
    const t = this.t;
    const row = (keys: string[], label: MessageKey) => [
      h(
        'dt',
        {},
        keys.map((k) => h('kbd', {}, k)),
      ),
      h('dd', {}, t(label)),
    ];
    const [prevK, nextK] = this.dir === 'rtl' ? ['→', '←'] : ['←', '→'];
    this.helpEl.setAttribute('aria-label', t('help.title'));
    this.helpEl.replaceChildren(
      h(
        'div',
        { class: 'wq-help-box' },
        h('h2', {}, t('help.title')),
        h(
          'div',
          { class: 'wq-help-cols' },
          h(
            'div',
            {},
            h('h3', {}, t('help.lesson')),
            h(
              'dl',
              {},
              row(['Space'], 'help.playPause'),
              row([prevK, nextK], 'help.prevNext'),
              row(['Shift', prevK, nextK], 'help.prevNextQ'),
              row(['Home'], 'help.restart'),
              row(['C'], 'help.captions'),
              row(['T'], 'help.transcript'),
              row(['F'], 'help.fullscreen'),
              row(['?'], 'help.help'),
            ),
          ),
          h(
            'div',
            {},
            h('h3', {}, t('help.questions')),
            h(
              'dl',
              {},
              row(['1', '–', '6'], 'help.choose'),
              row(['T', 'F'], 'help.trueFalse'),
              row(['↑', '↓'], 'help.rows'),
              row(['Enter'], 'help.check'),
              row(['S'], 'help.show'),
              row(['Esc'], 'help.leave'),
            ),
          ),
        ),
        h('p', { class: 'wq-help-close' }, t('help.close')),
      ),
    );
    this.helpEl.addEventListener('click', (e) => {
      if (e.target === this.helpEl) this.helpEl.close();
    });
  }

  private buildTranscript() {
    if (!this.transcriptEl) return;
    const t = this.t;
    const close = h(
      'button',
      { class: 'wq-icon', type: 'button', 'aria-label': t('transcript.close'), onclick: () => this.toggleTranscript() },
      '×',
    );
    const list = h('ol', {});
    this.compiled.beats.forEach((cb, i) => {
      const li = h(
        'li',
        { 'data-i': String(i) },
        h('button', { type: 'button', class: 'wq-tr-beat', onclick: () => this.seek(i, true) }, cb.beat.title),
        h('p', {}, narrationText(cb.beat.narration)),
      );
      list.append(li);
    });
    this.transcriptEl.setAttribute('aria-label', t('transcript.title'));
    this.transcriptEl.replaceChildren(
      h('div', { class: 'wq-tr-head' }, h('h2', {}, t('transcript.title')), close),
      list,
    );
  }

  private fitObserver() {
    const fit = () => {
      const vp = this.frame.parentElement!;
      const w = vp.clientWidth;
      const hh = vp.clientHeight;
      if (!w || !hh) return;
      const k = Math.min(w / 1600, hh / 900);
      this.frame.style.setProperty('--k', String(k));
      this.root.style.setProperty('--k', String(k));
    };
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(this.frame.parentElement!);
    fit();
  }

  /* ---------- playback ---------- */

  private beat(): CompiledBeat {
    return this.compiled.beats[this.i]!;
  }

  begin(): void {
    this.started = true;
    this.cover.hidden = true;
    this.root.focus({ preventScroll: true });
    this.seek(this.i, true);
  }

  seek(i: number, play = this.playing): void {
    if (i < 0 || i >= this.compiled.beats.length) return;
    this.stopAudio();
    this.closeCard();
    this.i = i;
    this.time = 0;
    this.extra.clear();
    this.cardShown = false;
    const cb = this.beat();
    // a beat's layout continues the previous one (nodes that stay or fade out): build that first when jumping
    if (i > 0 && this.builtIndex !== i - 1) {
      const prev = this.compiled.beats[i - 1]!;
      this.renderer.build(prev, this.cardPlace(prev));
    }
    if (i === 0) this.renderer.boxes = new Map();
    this.renderer.build(cb, this.cardPlace(cb));
    this.builtIndex = i;
    this.render();
    this.opts.onEvent?.({ type: 'beat', index: i, id: cb.id });
    this.saveProgress();
    if (play && this.started) this.play();
    else this.setPlaying(false);
  }

  play(): void {
    if (!this.started) {
      this.begin();
      return;
    }
    this.setPlaying(true);
    const cb = this.beat();
    const src = this.data.audio?.[this.lang]?.[cb.id];
    if (src && !this.audioFailed && this.time < cb.timing.dur) {
      if (!this.audio) {
        this.audio = new Audio(src);
        this.audio.preload = 'auto';
        this.audioStartedAt = performance.now();
        if (this.time > 0.05) this.audio.currentTime = this.time;
      }
      this.audio.play().catch(() => this.soundFailed());
    }
    this.prefetch();
    this.lastNow = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((n) => this.frameTick(n));
  }

  pause(): void {
    this.audio?.pause();
    this.setPlaying(false);
  }

  togglePlay(): void {
    if (!this.started) {
      this.begin();
      return;
    }
    if (this.playing) this.pause();
    else this.play();
  }

  private setPlaying(v: boolean) {
    this.playing = v;
    this.root.classList.toggle('wq-playing', v);
    this.pausedEl.hidden = v || !this.started || this.reviewMode || this.beat().ask;
    if (this.playBtn) this.playBtn.replaceChildren(svgIcon(v ? 'pause' : 'play'));
    if (!v) cancelAnimationFrame(this.raf);
  }

  private soundFailed() {
    this.audioFailed = true;
    this.soundNote.hidden = false;
  }

  private stopAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    this.audio = null;
  }

  private prefetch() {
    const next = this.compiled.beats[this.i + 1];
    const src = next && this.data.audio?.[this.lang]?.[next.id];
    if (src) {
      const l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = src;
      if (!document.head.querySelector(`link[href="${CSS.escape(src)}"]`)) document.head.append(l);
    }
  }

  private frameTick(now: number) {
    if (this.destroyed || !this.playing) return;
    const dt = Math.min(0.25, (now - this.lastNow) / 1000);
    this.lastNow = now;
    const a = this.audio;
    if (a && !a.paused && !a.ended && a.currentTime > 0) this.time = Math.max(this.time, a.currentTime);
    else {
      this.time += dt;
      // audio that never starts counts as a failure; the lesson continues on the wall clock
      if (a && a.currentTime === 0 && !this.audioFailed && now - this.audioStartedAt > 4000 && a.readyState < 3)
        this.soundFailed();
    }
    this.render();
    const cb = this.beat();
    this.maybeAsk();
    if (!cb.ask && this.time >= cb.end) {
      if (this.i < this.compiled.beats.length - 1) return this.seek(this.i + 1, true);
      this.setPlaying(false);
      return;
    }
    this.raf = requestAnimationFrame((n) => this.frameTick(n));
  }

  private maybeAsk() {
    const cb = this.beat();
    if (!cb.ask || this.cardShown || this.time < cb.askAt) return;
    this.cardShown = true;
    if (cb.beat.move === 'finish' && !cb.beat.questions?.length) this.finishCard();
    else this.openQuestions(cb);
  }

  /** Draw the picture at the current time. */
  render(): void {
    const cb = this.beat();
    const t = this.reducedMotion ? this.snapTime(cb, this.time) : this.time;
    const base = sampler(cb, t, this.extra);
    this.renderer.update(base, t);
    this.updateUi();
  }

  /** With reduced motion, every change jumps to its end state. */
  private snapTime(cb: CompiledBeat, t: number): number {
    let snapped = t;
    for (const list of cb.segs.values())
      for (const s of list) if (s.t0 <= t && t < s.t0 + s.dur) snapped = Math.max(snapped, s.t0 + s.dur);
    return snapped;
  }

  private updateUi() {
    const cb = this.beat();
    const segs = this.segsEl?.children;
    if (segs) {
      for (let k = 0; k < segs.length; k++) {
        const fill =
          k < this.i ? 1 : k > this.i ? 0 : Math.min(1, this.time / Math.max(0.1, cb.ask ? cb.timing.dur : cb.end));
        (segs[k] as HTMLElement).style.setProperty('--f', fill.toFixed(3));
        segs[k]!.classList.toggle('wq-cur', k === this.i);
      }
    }
    if (this.stepName)
      this.stepName.textContent = `${this.t('bar.stepOf', { i: this.i + 1, n: this.compiled.beats.length })} · ${cb.beat.title}`;
    if (this.captionsOn) this.updateCaption(cb);
    const cur = this.transcriptEl.querySelector('li.wq-cur');
    if (cur?.getAttribute('data-i') !== String(this.i)) {
      cur?.classList.remove('wq-cur');
      this.transcriptEl.querySelector(`li[data-i="${this.i}"]`)?.classList.add('wq-cur');
    }
  }

  next(): void {
    if (this.i < this.compiled.beats.length - 1) this.seek(this.i + 1, this.playing || this.beat().ask);
  }

  prev(): void {
    if (this.time > 2 && !this.beat().ask) this.seek(this.i, this.playing);
    else if (this.i > 0) this.seek(this.i - 1, this.playing);
  }

  restart(): void {
    this.scores = {};
    this.saveScores();
    this.finished = false;
    this.started = true;
    this.cover.hidden = true;
    this.seek(0, true);
  }

  /* ---------- questions ---------- */

  private cardPlace(cb: CompiledBeat): CardPlace {
    if (!cb.ask) return null;
    if (cb.beat.move === 'finish') return 'screen';
    // a pick question needs its picture visible: never cover it with a full-screen card
    const picks = cb.beat.questions?.some((q) => q.kind === 'pick');
    const big = Object.values(cb.start.nodes).some(
      (n) => !cb.leaving.includes(n.id) && (n.slot === 'main' || n.slot === 'lower' || n.slot === 'band'),
    );
    const p = cb.beat.card?.place ?? 'auto';
    // …nor with a band over the lower half of a large picture
    if (picks && big && (p === 'band' || p === 'screen')) return 'side';
    if (p !== 'auto' && !(picks && p === 'screen')) return p;
    if (!picks && (cb.beat.card?.label === 'practice' || cb.beat.move === 'practice')) return 'screen';
    const slots = Object.values(cb.start.nodes)
      .filter((n) => !cb.leaving.includes(n.id))
      .map((n) => n.slot);
    return slots.some((s) => s === 'lower' || s === 'band' || s === 'main') ? 'side' : 'band';
  }

  private practiceLabel(cb: CompiledBeat): string {
    const practice = this.compiled.beats.filter(
      (b) => b.beat.card?.label === 'practice' || (b.beat.move === 'practice' && b.beat.questions),
    );
    const k = practice.indexOf(cb) + 1;
    return this.t('quiz.practice', { k, n: practice.length });
  }

  private openQuestions(cb: CompiledBeat) {
    const isPractice = cb.beat.card?.label === 'practice' || cb.beat.move === 'practice';
    const place = this.cardPlace(cb) ?? 'band';
    this.card = openCard(
      this.cardHost,
      cb.beat.questions!,
      {
        place,
        kind: isPractice ? 'practice' : 'check',
        label: isPractice ? this.practiceLabel(cb) : this.t('quiz.quickCheck'),
      },
      {
        lang: this.lang,
        dir: this.dir,
        t: this.t,
        fmt: (n) => formatNumber(n, this.lang, { digits: this.data.book?.digits ?? 'latn' }),
        score: (q) => this.scores[q],
        record: (q, s) => {
          this.scores[q] = s;
          this.saveScores();
          this.opts.onEvent?.({ type: 'answer', qid: q, score: s });
        },
        resolve: (q) => this.playResolve(cb, q),
        partBox: (node, sub) => this.renderer.partBox(node, sub),
        pickables: (node) => {
          const n = cb.start.nodes[node];
          if (!n) return [];
          // the component says which of its parts can be picked (map regions, clock hands…)
          const own = componentDef(n.type)?.pickable?.(n.props as never);
          if (own) return own;
          return Object.keys(n.subs).filter((s) => /^(tick|tok|item|bar|step|event|node|cell):/.test(s));
        },
        overlay: this.overlay,
        done: () => this.next(),
      },
    );
    this.pausedEl.hidden = true;
  }

  private playResolve(cb: CompiledBeat, qid: string) {
    const segs = cb.resolve[qid] ?? [];
    const t0 = this.time;
    for (const s of segs) {
      const k = segKey(s.node, s.sub, s.ch);
      const list = this.extra.get(k) ?? [];
      list.push({ ...s, t0: s.t0 + t0 });
      this.extra.set(k, list);
    }
    if (!this.playing) {
      // keep animating the answer effect even while paused
      const start = performance.now();
      const tick = (n: number) => {
        if (this.playing || this.destroyed) return;
        this.time = t0 + (n - start) / 1000;
        this.render();
        if (n - start < 2500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  private closeCard() {
    this.card?.destroy();
    this.card = null;
    this.overlay.replaceChildren();
    this.cardHost.replaceChildren();
  }

  private finishCard() {
    const t = this.t;
    const all = Object.values(this.scores);
    const sum = (k: 'check' | 'practice') =>
      all.filter((s) => s.kind === k).reduce((a, s) => ({ r: a.r + s.right, n: a.n + s.total }), { r: 0, n: 0 });
    const right = all.reduce((a, s) => a + s.right, 0);
    const total = all.reduce((a, s) => a + s.total, 0);
    const lesson = this.lesson;
    const next = this.data.book?.next;
    const home = this.data.book?.home;
    const card = h(
      'section',
      { class: 'wq-card wq-card-screen wq-finish', role: 'region', 'aria-label': t('finish.titleNoChapter') },
      h('div', { class: 'wq-mascot', 'aria-hidden': 'true' }, '∞'),
      h('h2', {}, lesson.number !== undefined ? t('finish.title', { n: lesson.number }) : t('finish.titleNoChapter')),
      h('p', { class: 'wq-finish-sub' }, lesson.title),
      total
        ? h('p', { class: 'wq-finish-score' }, t('finish.score', { right, total }))
        : h('p', {}, t('finish.noScore')),
      total
        ? h(
            'ul',
            { class: 'wq-finish-list' },
            (['check', 'practice'] as const).map((k) => {
              const s = sum(k);
              return s.n
                ? h(
                    'li',
                    {},
                    `${t(k === 'check' ? 'finish.checks' : 'finish.practice')}: ${t('quiz.progress', { k: s.r, n: s.n })}`,
                  )
                : null;
            }),
          )
        : null,
      h(
        'div',
        { class: 'wq-actions' },
        h(
          'button',
          { type: 'button', class: 'wq-btn', onclick: () => this.restart(), 'aria-keyshortcuts': 'R' },
          t('finish.again'),
        ),
        home ? h('a', { class: 'wq-btn', href: home }, t('finish.contents')) : null,
        next
          ? h('a', { class: 'wq-btn wq-primary', href: next, 'aria-keyshortcuts': 'Enter' }, t('finish.next'))
          : null,
      ),
    );
    this.cardHost.replaceChildren(card);
    this.live.textContent = `${t('finish.titleNoChapter')}. ${total ? t('finish.score', { right, total }) : ''}`;
    (card.querySelector('.wq-primary') as HTMLElement | null)?.focus();
    if (!this.finished) {
      this.finished = true;
      this.markDone();
      this.opts.onEvent?.({ type: 'finish', right, total });
    }
    this.card = {
      el: card,
      key: (e) => {
        if (e.code === 'KeyR') {
          this.restart();
          return true;
        }
        if (
          (e.code === 'Enter' || e.code === 'NumpadEnter') &&
          next &&
          (e.target as HTMLElement)?.tagName !== 'BUTTON'
        ) {
          location.href = next;
          return true;
        }
        return false;
      },
      destroy: () => card.remove(),
    };
  }

  /* ---------- chrome toggles ---------- */

  /** Caption of the sentence being spoken; with word times, the current word is highlighted (read-along). */
  private updateCaption(cb: CompiledBeat): void {
    const caps = cb.timing.captions;
    let ci = -1;
    caps.forEach(([at], i) => {
      if (at <= this.time + 0.05) ci = i;
    });
    if (this.time > cb.timing.dur + 0.5) ci = -1;
    const key = `${this.i}:${ci}`;
    if (key !== this.capKey) {
      this.capKey = key;
      this.capWords = [];
      this.capLit = undefined;
      this.captionEl.replaceChildren();
      const cap = ci >= 0 ? (caps[ci]?.[1] ?? '') : '';
      const words = cb.timing.words;
      const clean = words?.length ? spokenText(cb.beat.narration).clean : '';
      const sentence = clean ? splitSentences(clean)[ci] : undefined;
      if (cap && words?.length && sentence && sentence.text === cap) {
        let at = sentence.start;
        for (const w of splitWords(clean).filter((x) => x.start >= sentence.start && x.end <= sentence.end)) {
          if (w.start > at) this.captionEl.append(clean.slice(at, w.start));
          const el = h('span', {}, clean.slice(w.start, w.end));
          const k = words.findIndex(([, a]) => a === w.start);
          if (k >= 0) this.capWords.push({ k, el });
          this.captionEl.append(el);
          at = w.end;
        }
        this.captionEl.append(clean.slice(at, sentence.end));
      } else this.captionEl.textContent = cap;
      this.captionEl.hidden = !cap;
    }
    if (this.capWords.length) {
      const k = wordAt(cb.timing.words, this.time, cb.timing.dur);
      const el = this.capWords.find((w) => w.k === k)?.el;
      if (el !== this.capLit) {
        this.capLit?.classList.remove('wq-now');
        el?.classList.add('wq-now');
        this.capLit = el;
      }
    }
  }

  setCaptions(on: boolean): void {
    this.captionsOn = on;
    this.capKey = '';
    this.captionEl.hidden = !on;
    this.captionEl.setAttribute('dir', 'auto');
    try {
      localStorage.setItem(CAPTIONS_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    this.bar.querySelector('.wq-cc')?.setAttribute('aria-pressed', String(on));
    this.render?.call(this);
  }

  toggleTranscript(): void {
    this.transcriptEl.hidden = !this.transcriptEl.hidden;
    this.root.classList.toggle('wq-with-transcript', !this.transcriptEl.hidden);
    this.bar.querySelectorAll('.wq-txt')[0]?.setAttribute('aria-pressed', String(!this.transcriptEl.hidden));
    if (!this.transcriptEl.hidden) (this.transcriptEl.querySelector('li.wq-cur button') as HTMLElement | null)?.focus();
  }

  /** Teacher panel from the book data, or ad hoc with ?panel in the address. */
  private panelConfig(): PanelConfig | null {
    if (this.data.panel) return this.data.panel;
    try {
      if (new URLSearchParams(location.search).has('panel'))
        return { kit: this.data.book?.id ?? 'warqa', code: this.skeleton.id };
    } catch {
      /* no location (embedded) */
    }
    return null;
  }

  toggleRating(): void {
    if (!this.panel) return;
    if (!this.panel.open) this.setPlaying(false);
    this.panel.toggle();
  }

  toggleHelp(): void {
    if (this.helpEl.open) this.helpEl.close();
    else this.helpEl.showModal();
  }

  toggleFull(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.root.requestFullscreen?.();
  }

  /* ---------- keyboard ---------- */

  private keyHandler(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.helpEl.open || this.panel?.open) return;
    const target = e.target as HTMLElement;
    if (target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return;
    const cb = this.beat();
    const asking = cb.ask && this.cardShown && this.card;
    if (asking && this.card!.key(e)) {
      e.preventDefault();
      return;
    }
    if (target?.tagName === 'INPUT') return;
    const [prevCode, nextCode] = this.dir === 'rtl' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
    const isHelp = e.key === '?' || e.key === '؟' || (e.code === 'Slash' && e.shiftKey);
    let handled = true;
    if (!this.started && (e.code === 'Space' || e.code === 'Enter')) this.begin();
    else if (isHelp) this.toggleHelp();
    else if (e.code === 'Space' && target?.tagName !== 'BUTTON') this.togglePlay();
    else if ((e.code === nextCode || e.code === prevCode) && (!asking || e.shiftKey)) {
      if (e.code === nextCode) this.next();
      else this.prev();
    } else if (e.code === 'Home') this.restart();
    else if (e.code === 'KeyC') this.setCaptions(!this.captionsOn);
    else if (e.code === 'KeyR' && this.panel && !asking) this.toggleRating();
    else if (e.code === 'KeyT' && !asking) this.toggleTranscript();
    else if (e.code === 'KeyF' && !asking) this.toggleFull();
    else if (e.code === 'Escape' && !this.transcriptEl.hidden) this.toggleTranscript();
    else handled = false;
    if (handled) e.preventDefault();
  }

  /* ---------- progress ---------- */

  private storeKey(kind: string) {
    return `warqa:${kind}:${this.data.book?.id ?? 'lesson'}`;
  }

  private loadScores() {
    if (this.opts.storage === false) return;
    try {
      const v = JSON.parse(localStorage.getItem(`${this.storeKey('scores')}:${this.skeleton.id}`) ?? '{}');
      if (v && typeof v === 'object' && !Array.isArray(v)) this.scores = v;
    } catch {
      this.scores = {};
    }
  }

  private saveScores() {
    if (this.opts.storage === false) return;
    try {
      localStorage.setItem(`${this.storeKey('scores')}:${this.skeleton.id}`, JSON.stringify(this.scores));
    } catch {
      /* storage unavailable */
    }
  }

  private readProgress(): { last?: string; done: string[]; lang?: string } {
    try {
      const v = JSON.parse(localStorage.getItem(this.storeKey('progress')) ?? '{}');
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { done: [] };
      return {
        last: typeof v.last === 'string' ? v.last : undefined,
        done: Array.isArray(v.done) ? v.done.filter((x: unknown) => typeof x === 'string') : [],
        lang: typeof v.lang === 'string' ? v.lang : undefined,
      };
    } catch {
      return { done: [] };
    }
  }

  private saveProgress() {
    if (this.opts.storage === false || !this.started) return;
    try {
      const p = this.readProgress();
      localStorage.setItem(
        this.storeKey('progress'),
        JSON.stringify({ ...p, last: this.skeleton.id, lang: this.lang }),
      );
    } catch {
      /* storage unavailable */
    }
  }

  private markDone() {
    if (this.opts.storage === false) return;
    try {
      const p = this.readProgress();
      if (!p.done.includes(this.skeleton.id)) p.done.push(this.skeleton.id);
      localStorage.setItem(
        this.storeKey('progress'),
        JSON.stringify({ ...p, last: this.skeleton.id, lang: this.lang }),
      );
    } catch {
      /* storage unavailable */
    }
  }

  /* ---------- testing / QA hooks ---------- */

  /** Freeze at a beat and time (used by screenshots and tests). */
  freeze(beat: number, t: number): void {
    this.reviewMode = true;
    this.pause();
    this.started = true;
    this.cover.hidden = true;
    if (beat !== this.i) this.seek(beat, false);
    this.time = t;
    this.render();
    this.maybeAsk();
  }

  /** Reveal the answer of the open question card (used by video export). */
  revealAnswers(): void {
    this.card?.reveal?.();
  }

  qa() {
    return { overflows: this.renderer.overflows(), boxes: this.renderer.layoutBoxes(), issues: this.compiled.issues };
  }

  destroy(): void {
    this.destroyed = true;
    this.stopAudio();
    cancelAnimationFrame(this.raf);
    (this.opts.keyboard === 'local' ? this.root : window).removeEventListener(
      'keydown',
      this.keyHandler as EventListener,
    );
    this.root.remove();
  }
}

const ICONS: Record<string, string> = {
  play: 'M4 2v14l12-7z',
  pause: 'M3.5 2h4v14h-4zM10.5 2h4v14h-4z',
  back: 'M3 2h2.5v14H3zM16 2v14L6.5 9z',
  next: 'M15 2h-2.5v14H15zM2 2v14l9.5-7z',
  restart: 'M9 2.5a6.5 6.5 0 1 1-6.3 8.1l2-.5A4.5 4.5 0 1 0 9 4.5V7L4.5 3.5 9 0z',
  grid: 'M2 2h6v6H2zM10 2h6v6h-6zM2 10h6v6H2zM10 10h6v6h-6z',
  full: 'M1 1h6v2H3v4H1zM11 1h6v6h-2V3h-4zM1 11h2v4h4v2H1zM15 11h2v6h-6v-2h4z',
  transcript: 'M3 3h12v2H3zM3 7h12v2H3zM3 11h8v2H3z',
};

function svgIcon(name: string): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 18 18', 'aria-hidden': 'true', class: `wq-i wq-i-${name}` });
  svg('path', { d: ICONS[name] ?? '' }, s);
  return s;
}
