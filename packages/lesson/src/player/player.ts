// The lesson player: clock, audio, beats, questions, captions, transcript, keyboard and progress.
// Portions derived from Papermorph (MIT): the player model (beats, audio-driven clock, segments bar, cover,
// help overlay, finish card, "?beat=&t=" review frames, sound-failure fallback).

import type { IconName } from '@warqa/brand';
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
import { h, icon, markIcon, rich, svg } from './dom.js';
import { dragSheet, onHold, onSurface } from './gestures.js';
import { type PanelConfig, RatingPanel } from './panel.js';
import { type CardController, openCard, type Score } from './quiz.js';
import { type CardPlace, SceneRenderer } from './scene.js';
import { activeTheme, setTheme as setPalette, type Theme, themeOf } from './theme.js';

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
    /** The book's theme: sheet (the default), board, or chalk (shown as the board). */
    theme?: string;
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
  /** Force a theme (otherwise: ?theme= in the address, the learner's last choice, then the book's). */
  theme?: Theme;
  /** The stage alone, edge to edge, with no strip, captions or bar (?bare: video export, QA shots, thumbnails). */
  bare?: boolean;
  /** Show the strip above the stage (default true; a host page that has its own title turns it off). */
  head?: boolean;
  /**
   * Someone learning on their own, in the studio: the finish card asks how the chapter was (the host moves the
   * level of the next chapters), offers to review what was missed and the next chapter, made on demand. Exported
   * books leave it out and keep the plain finish card.
   */
  learner?: LearnerOptions;
  onEvent?: (e: PlayerEvent) => void;
}

export type LearnerFeedback = 'too-easy' | 'right' | 'too-hard';

export interface LearnerOptions {
  /** The learner's level now, in words ("I know some"), shown under the feel question ("Your level now: …"). */
  level?: string;
  /** A choice in "How was this chapter?". The host saves it and may resolve to the new level's words. */
  // biome-ignore lint/suspicious/noConfusingVoidType: an async host that returns nothing gives a Promise<void>
  onFeedback?: (f: LearnerFeedback) => void | string | undefined | Promise<string | undefined | void>;
  /**
   * The next chapter of the course. made: true → a "Next chapter" button that just opens it (run()).
   * made: false → the costed "Make chapter {n} · about {cost}" button (nothing is spent before the click), run()
   * starts it; the host then reports progress with Player.learnerNext().
   */
  next?: { n: number; title: string; cost?: string; made?: boolean; run: () => void };
  /** "All chapters" / the learner's home (What I'm learning). */
  home?: () => void;
}

/** The next chapter being made from the finish card, as the host reports it (Player.learnerNext). */
export type LearnerNextState =
  | { status: 'idle' }
  | { status: 'making'; pct?: number }
  | { status: 'ready'; open: () => void }
  | { status: 'error'; message: string };

export type PlayerEvent =
  | { type: 'beat'; index: number; id: string }
  | { type: 'answer'; qid: string; score: Score }
  | { type: 'finish'; right: number; total: number }
  | { type: 'lang'; lang: string };

const CAPTIONS_KEY = 'warqa:captions';
const THEME_KEY = 'warqa:theme';
const SPEED_KEY = 'warqa:speed';
/** Playback speeds; the voice keeps its pitch. */
export const SPEEDS: readonly number[] = [0.75, 1, 1.25, 1.5];

/** The letters on an Arabic keyboard's keys (the shortcuts match the key, not the letter). */
const AR_KEYS: Record<string, string> = { C: 'ؤ', T: 'ف', F: 'ب', R: 'ق', S: 'س' };
let players = 0;

export class Player {
  readonly root: HTMLElement;
  private frame!: HTMLElement;
  private stage!: SVGSVGElement;
  private scene!: SVGGElement;
  private htmlLayer!: HTMLDivElement;
  private overlay!: HTMLDivElement;
  private cardHost!: HTMLDivElement;
  private captionEl!: HTMLParagraphElement;
  private pausedEl!: HTMLDivElement;
  private soundNote!: HTMLParagraphElement;
  /** The browser would not play sound before a tap (autoplay): the lesson waits under "Tap to play the sound". */
  private tapEl!: HTMLDivElement;
  private soundBlocked = false;
  /** No recorded voice in this language: the words light up at reading speed under the stage, said so. */
  private voiceNote!: HTMLDivElement;
  private noVoice = false;
  /** Phones: the Listening sheet (language, speed, read-along, Sheet or Board), its button, and the veil. */
  private listenEl!: HTMLElement;
  private listenBtn: HTMLButtonElement | null = null;
  private veil!: HTMLButtonElement;
  /** Phones: the transcript at full height (else half). */
  private trFull = false;
  /** Phones: "waiting for your answer" in place of the controls while a question waits under the stage. */
  private waitEl: HTMLElement | null = null;
  /** A word heard again on its own (press and hold), and its pill. */
  private heldAudio: HTMLAudioElement | null = null;
  private wordPill!: HTMLElement;
  private heldTimers: ReturnType<typeof setTimeout>[] = [];
  /** Steps seen (left after being shown). */
  private seen = new Set<number>();
  /** Gesture listeners to remove; a sheet's drag, removed when the sheet is drawn again. */
  private offs: (() => void)[] = [];
  private dragOffs = new Map<string, () => void>();
  private cover!: HTMLButtonElement;
  private helpEl!: HTMLDialogElement;
  private panel: RatingPanel | null = null;
  private transcriptEl!: HTMLElement;
  private bar!: HTMLElement;
  private head!: HTMLElement;
  private marginLine!: SVGPathElement;
  private themeBtn!: HTMLButtonElement;
  private speedBtn!: HTMLButtonElement;
  private speedMenu!: HTMLElement;
  private theme: Theme = 'sheet';
  private rate = 1;
  private stepKey = '';
  private readonly uid = ++players;
  /** Phones: question cards sit under the stage instead of inside the small picture. */
  private cardsOut = false;
  private phone: MediaQueryList | null = null;
  private onPhone = () => {
    this.placeCards(true);
    this.translatePaused();
    if (!this.phone?.matches) {
      this.toggleListen(false);
      this.setTrFull(false);
    }
  };
  private onOutside = (e: PointerEvent) => {
    if (!(e.target as Element).closest?.('.wq-speedwrap')) this.toggleSpeedMenu(false);
  };
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
  /** The learner's finish card: the answer to "How was this chapter?" and the level it led to, kept if it redraws. */
  private feel: LearnerFeedback | null = null;
  private feelLevel: string | undefined;
  private feelAsk = 0;
  /** The next chapter's state, and where the shown finish card draws it. */
  private nextState: LearnerNextState = { status: 'idle' };
  private nextEl: HTMLElement | null = null;
  private captionsOn = false;
  /** Caption being shown (beat:sentence) and its word spans, for the word-by-word highlight. */
  private capKey = '';
  private capWords: { k: number; el: HTMLElement }[] = [];
  private capK = -2;
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
    this.root = h('div', {
      class: `wq-player${opts.bare ? ' wq-bare' : ''}${opts.head === false ? ' wq-nohead' : ''}`,
      tabindex: '-1',
    });
    host.append(this.root);
    this.theme = this.initialTheme();
    this.applyTheme();
    try {
      const r = Number(localStorage.getItem(SPEED_KEY));
      if (SPEEDS.includes(r)) this.rate = r;
    } catch {
      /* storage unavailable */
    }
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.phone = typeof matchMedia === 'function' ? matchMedia('(max-width: 640px)') : null;
    try {
      // on a phone the words under the picture are on until the learner turns them off
      const saved = localStorage.getItem(CAPTIONS_KEY);
      this.captionsOn = saved === null ? !!this.phone?.matches && !opts.bare : saved === '1';
    } catch {
      /* storage unavailable */
    }
    this.buildDom();
    this.applyLang(this.lang);
    this.loadScores();
    this.placeCards(false);
    this.phone?.addEventListener?.('change', this.onPhone);
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
    // nothing recorded in this language (the editor's bare stage aside): the captions are the narration
    this.noVoice = !this.opts.bare && !Object.keys(this.data.audio?.[lang] ?? {}).length;
    // nothing to tap for in a language with no voice
    if (this.noVoice && this.tapEl) this.setSoundBlocked(false);
    this.dir = dirOf(lang);
    const digits = this.data.book?.digits ?? 'latn';
    this.t = translator(lang, { digits });
    this.root.setAttribute('lang', lang);
    this.root.setAttribute('dir', this.dir);
    this.root.classList.toggle('wq-rtl', this.dir === 'rtl');
    // the paper's margin line sits at the inline start, outside the slots (80 to 1520), on the right in Arabic;
    // the picture never mirrors
    this.marginLine?.setAttribute('d', this.dir === 'rtl' ? 'M1562 0V900' : 'M38 0V900');
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

  /** The language's name inside a sentence of its own ("français" in French, lowercase), else its menu name. */
  private langInText(): string {
    try {
      const n = new Intl.DisplayNames([this.lang], { type: 'language' }).of(this.lang);
      if (n && n !== this.lang) return n;
    } catch {
      /* no display names for this language */
    }
    return LANG_INFO[this.lang as keyof typeof LANG_INFO]?.name ?? langInfo(this.lang).name;
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

  /* ---------- theme and speed ---------- */

  private initialTheme(): Theme {
    let fromUrl: Theme | undefined;
    let saved: Theme | undefined;
    try {
      fromUrl = themeOf(new URLSearchParams(location.search).get('theme'));
    } catch {
      /* no location (embedded) */
    }
    try {
      saved = themeOf(localStorage.getItem(THEME_KEY));
    } catch {
      /* storage unavailable */
    }
    return themeOf(this.opts.theme) ?? fromUrl ?? saved ?? themeOf(this.data.book?.theme) ?? 'sheet';
  }

  private applyTheme() {
    setPalette(this.theme);
    this.root.classList.toggle('wq-theme-sheet', this.theme === 'sheet');
    this.root.classList.toggle('wq-theme-board', this.theme === 'board');
    if (this.themeBtn) {
      const label = this.t(this.theme === 'sheet' ? 'theme.toBoard' : 'theme.toSheet');
      this.themeBtn.setAttribute('aria-label', label);
      this.themeBtn.title = label;
      this.themeBtn.replaceChildren(icon(this.theme === 'sheet' ? 'board-theme' : 'sheet-theme'));
    }
  }

  /** Switch between the white Sheet and the navy Board, keeping the place; the choice is remembered. */
  setTheme(name: Theme): void {
    const theme = themeOf(name);
    if (!theme || theme === this.theme) return;
    this.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage unavailable */
    }
    this.applyTheme();
    this.redraw();
    for (const b of this.listenEl?.querySelectorAll<HTMLElement>('[data-look]') ?? []) {
      const on = (b.dataset.look === 'sheet') === (theme === 'sheet');
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  /** Phones put the question cards under the stage, full size; the picture then keeps its whole width. */
  private placeCards(rebuild: boolean) {
    const out = !!this.phone?.matches && !this.opts.bare;
    if (out === this.cardsOut && rebuild) return;
    this.cardsOut = out;
    const asked = rebuild && this.cardShown;
    if (asked) {
      this.closeCard();
      this.cardShown = false;
    }
    this.cardHost.classList.toggle('wq-cards-out', out);
    if (out) this.frame.parentElement!.after(this.cardHost);
    else this.frame.insertBefore(this.cardHost, this.pausedEl);
    if (rebuild) this.redraw();
    if (asked) this.maybeAsk();
  }

  /** Where the scene leaves room for a card (nowhere when the card sits under the stage). */
  private layoutPlace(cb: CompiledBeat): CardPlace {
    return this.cardsOut ? null : this.cardPlace(cb);
  }

  /** Several players may share a page with different themes: each sets its palette before it draws. */
  private usePalette() {
    if (activeTheme() !== this.theme) setPalette(this.theme);
  }

  /** Rebuild the picture at the same moment (after the palette changed). */
  private redraw() {
    if (this.destroyed) return;
    this.usePalette();
    const cb = this.beat();
    if (this.i > 0) {
      const prev = this.compiled.beats[this.i - 1]!;
      this.renderer.build(prev, this.layoutPlace(prev));
    } else this.renderer.boxes = new Map();
    this.renderer.build(cb, this.layoutPlace(cb));
    this.builtIndex = this.i;
    this.render();
  }

  private fmtRate(r: number): string {
    return `${formatNumber(r, this.lang, { digits: this.data.book?.digits ?? 'latn' })}×`;
  }

  /** Playback speed (0.75× to 1.5×): the audio's rate, or the clock's when there is no audio. */
  setSpeed(rate: number): void {
    if (!SPEEDS.includes(rate)) return;
    this.rate = rate;
    if (this.audio) this.audio.playbackRate = rate;
    try {
      localStorage.setItem(SPEED_KEY, String(rate));
    } catch {
      /* storage unavailable */
    }
    this.updateSpeed();
  }

  private updateSpeed() {
    if (!this.speedBtn) return;
    const label = this.t('bar.speed', { rate: this.fmtRate(this.rate) });
    this.speedBtn.setAttribute('aria-label', label);
    this.speedBtn.title = label;
    (this.speedBtn.querySelector('.wq-rate') as HTMLElement).textContent = this.fmtRate(this.rate);
    for (const b of this.speedMenu.querySelectorAll('button'))
      b.setAttribute('aria-checked', String(Number(b.dataset.rate) === this.rate));
    const rate = this.bar.querySelector('.wq-steprate');
    if (rate) rate.textContent = this.fmtRate(this.rate);
    for (const b of this.listenEl?.querySelectorAll<HTMLElement>('[data-rate]') ?? []) {
      const on = Number(b.dataset.rate) === this.rate;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  private toggleSpeedMenu(open = this.speedMenu.hidden) {
    if (open === !this.speedMenu.hidden) return;
    this.speedMenu.hidden = !open;
    this.speedBtn.setAttribute('aria-expanded', String(open));
    // a click anywhere outside closes it
    if (open) document.addEventListener('pointerdown', this.onOutside, true);
    else document.removeEventListener('pointerdown', this.onOutside, true);
    if (open) (this.speedMenu.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  }

  /* ---------- DOM ---------- */

  private buildDom() {
    const r = this.root;
    this.frame = h('div', { class: 'wq-frame' });
    this.stage = svg('svg', { class: 'wq-stage', viewBox: '0 0 1600 900', role: 'img' });
    // the paper: a faint ruling and the red margin line (the Board has its navy equivalent)
    const defs = svg('defs', {}, this.stage);
    const ruling = svg(
      'pattern',
      { id: `wq-ruling-${this.uid}`, width: 1600, height: 52, patternUnits: 'userSpaceOnUse' },
      defs,
    );
    svg('path', { class: 'wq-ruling', d: 'M0 51.5H1600' }, ruling);
    svg('rect', { width: 1600, height: 900, class: 'wq-board' }, this.stage);
    svg('rect', { width: 1600, height: 900, fill: `url(#wq-ruling-${this.uid})` }, this.stage);
    this.marginLine = svg('path', { class: 'wq-margin', d: 'M38 0V900' }, this.stage);
    this.scene = svg('g', { class: 'wq-scene' }, this.stage);
    this.htmlLayer = h('div', { class: 'wq-html' });
    this.overlay = h('div', { class: 'wq-overlay' });
    this.cardHost = h('div', { class: 'wq-cards' });
    // captions sit under the stage, never on the picture
    this.captionEl = h('p', { class: 'wq-caption', hidden: true, dir: 'auto' });
    // a word heard again on its own: its pill under the caption
    this.wordPill = h('p', { class: 'wq-wordpill', hidden: true, dir: 'auto' });
    // (for the pointer only: each sheet has its own Close)
    this.veil = h('button', {
      class: 'wq-veil',
      type: 'button',
      tabindex: '-1',
      'aria-hidden': 'true',
    }) as HTMLButtonElement;
    this.veil.addEventListener('click', () => {
      this.toggleListen(false);
      if (this.trFull) this.toggleTranscript();
    });
    // (focusable itself: a tap on its text keeps the focus inside, and Esc still closes it)
    this.listenEl = h('section', {
      class: 'wq-listen wq-bsheet',
      role: 'dialog',
      'aria-modal': 'true',
      tabindex: '-1',
    });
    this.listenEl.addEventListener('keydown', (e) => this.sheetKeys(e));
    this.voiceNote = h(
      'div',
      { class: 'wq-novoice', hidden: true },
      h('span', { class: 'wq-novoice-chip' }),
      h('p', { class: 'wq-novoice-line' }),
    );
    // paused: no dark veil, the picture stays readable
    this.pausedEl = h(
      'div',
      { class: 'wq-paused', hidden: true },
      h('span', { class: 'wq-paused-btn' }, icon('play', 40)),
      h('p', {}),
    );
    this.soundNote = h('p', { class: 'wq-soundnote', hidden: true, role: 'status' });
    this.tapEl = h(
      'div',
      { class: 'wq-tap', hidden: true },
      h('button', { class: 'wq-tap-btn', type: 'button' }, icon('voice', 22), h('span', {})),
    );
    // the tap is the gesture the browser waited for: the sound starts inside it, from where the lesson stands
    // (anywhere on the dimmed picture counts)
    this.tapEl.addEventListener('click', () => this.play());
    this.live = h('div', { class: 'wq-sr', 'aria-live': 'polite' });
    this.cover = h('button', { class: 'wq-cover', type: 'button' });
    this.cover.addEventListener('click', () => this.begin());
    this.frame.append(
      this.stage,
      this.htmlLayer,
      this.overlay,
      this.cardHost,
      this.pausedEl,
      this.soundNote,
      this.cover,
    );
    // (a tap on the paused picture is the stage's: onSurface, which a click would undo here)
    this.helpEl = h('dialog', { class: 'wq-help' }) as HTMLDialogElement;
    this.transcriptEl = h('aside', { class: 'wq-transcript', hidden: true });
    this.head = h('header', { class: 'wq-head' });
    this.bar = h('div', { class: 'wq-bar' });
    r.append(
      this.head,
      h(
        'div',
        { class: 'wq-main' },
        h(
          'div',
          { class: 'wq-stagecol' },
          // the tap button sits over the stage at its own size (the stage itself is scaled down on phones)
          h('div', { class: 'wq-viewport' }, this.frame, this.tapEl),
          this.voiceNote,
          this.captionEl,
          this.wordPill,
          this.bar,
        ),
        this.transcriptEl,
      ),
      this.veil,
      this.listenEl,
      this.helpEl,
      this.live,
    );
    this.bindGestures();
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

  private iconBtn(
    cls: string,
    label: string,
    name: IconName,
    fn: () => void,
    extra: Record<string, unknown> = {},
    short?: string,
  ): HTMLButtonElement {
    const b = h(
      'button',
      { class: `wq-icon ${cls}`.trim(), type: 'button', 'aria-label': label, title: label, ...extra },
      icon(name),
      // phones show a word next to the icon
      short ? h('span', { class: 'wq-lbl', 'aria-hidden': 'true' }, short) : null,
    );
    b.addEventListener('click', fn);
    return b;
  }

  private translateChrome() {
    const t = this.t;
    const b = this.lesson;
    this.stage.setAttribute('aria-label', t('lesson.aria'));
    this.translatePaused();
    this.soundNote.textContent = t('lesson.soundFailed');
    (this.tapEl.querySelector('span') as HTMLElement).textContent = t('lesson.tapSound');
    this.voiceNote.hidden = !this.noVoice;
    (this.voiceNote.firstChild as HTMLElement).textContent = t('lesson.noVoice');
    (this.voiceNote.lastChild as HTMLElement).textContent = t('lesson.noVoiceLine', { lang: this.langInText() });
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
        h('span', { class: 'wq-go' }, icon('play', 24), t('cover.start')),
        h(
          'small',
          {},
          `${b.number !== undefined ? t('cover.meta', { n: b.number, min: mins }) : t('cover.metaNoChapter', { min: mins })} · ${t('cover.hint')}`,
        ),
      ),
    );
    this.cover.setAttribute('aria-label', `${t('cover.start')}: ${b.title}`);
    this.buildHead();
    this.buildBar();
    this.buildHelp();
    this.buildListen();
    this.setCaptions(this.captionsOn, false);
  }

  /** "Paused · tap to continue" on a phone or a touch screen; with the Space key elsewhere. */
  private translatePaused() {
    const touch =
      !!this.phone?.matches || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
    (this.pausedEl.querySelector('p') as HTMLElement).textContent = this.t(
      touch ? 'lesson.pausedTouch' : 'lesson.paused',
    );
  }

  /** The strip above the stage: all lessons, the title, language, Sheet or Board, transcript, full screen. */
  private buildHead() {
    const t = this.t;
    const b = this.lesson;
    const home = this.data.book?.home
      ? h('a', { class: 'wq-home', href: this.data.book.home }, icon('book'), h('span', {}, t('bar.home')))
      : null;
    const kicker = [b.unit, b.number !== undefined ? t('head.chapter', { n: b.number }) : '']
      .filter(Boolean)
      .join(' · ');
    const langs = this.langs();
    const langSel =
      langs.length > 1
        ? h(
            'label',
            { class: 'wq-langsel' },
            icon('language'),
            h(
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
            ),
          )
        : null;
    this.themeBtn = this.iconBtn('wq-theme', '', 'board-theme', () =>
      this.setTheme(this.theme === 'sheet' ? 'board' : 'sheet'),
    );
    this.head.replaceChildren(
      h(
        'div',
        { class: 'wq-head-l' },
        home,
        h(
          'div',
          { class: 'wq-head-title' },
          kicker ? h('span', { class: 'wq-head-k' }, kicker) : null,
          h('h1', { dir: 'auto' }, rich(b.title)),
        ),
      ),
      h(
        'div',
        { class: 'wq-head-tools' },
        langSel,
        this.themeBtn,
        this.iconBtn('wq-txt', t('bar.transcript'), 'transcript', () => this.toggleTranscript(), {
          'aria-pressed': String(!this.transcriptEl.hidden),
        }),
        this.panel ? this.iconBtn('wq-rate-btn', t('panel.rate'), 'edit', () => this.toggleRating()) : null,
        h(
          'button',
          {
            class: 'wq-icon wq-help-btn',
            type: 'button',
            'aria-label': t('bar.help'),
            title: t('bar.help'),
            onclick: () => this.toggleHelp(),
          },
          h('span', { class: 'wq-key' }, '?'),
        ),
        this.iconBtn('wq-full', t('bar.fullscreen'), 'fullscreen', () => this.toggleFull()),
      ),
    );
    this.applyTheme();
  }

  /** The bar under the stage: play, back, next, the timeline with its questions, the step, speed, captions. */
  private buildBar() {
    const t = this.t;
    this.playBtn = this.iconBtn('wq-play', t('bar.play'), this.playing ? 'pause' : 'play', () => this.togglePlay());
    this.segsEl = h('div', { class: 'wq-segs' });
    this.stepName = h('div', { class: 'wq-stepname', 'aria-live': 'off' });
    this.stepKey = '';
    this.speedBtn = h(
      'button',
      {
        class: 'wq-icon wq-speed',
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        onclick: () => this.toggleSpeedMenu(),
      },
      h('span', { class: 'wq-lbl', 'aria-hidden': 'true' }, t('speed.title')),
      h('bdi', { class: 'wq-rate', dir: 'ltr' }),
    );
    this.speedMenu = h(
      'div',
      { class: 'wq-speedmenu', role: 'menu', hidden: true, 'aria-label': t('speed.title') },
      SPEEDS.map((r) =>
        h(
          'button',
          {
            type: 'button',
            role: 'menuitemradio',
            'data-rate': String(r),
            'aria-checked': String(r === this.rate),
            onclick: () => {
              this.setSpeed(r);
              this.toggleSpeedMenu(false);
              this.speedBtn.focus();
            },
          },
          this.fmtRate(r),
        ),
      ),
    );
    this.speedMenu.addEventListener('focusout', (e) => {
      if (!this.speedMenu.contains(e.relatedTarget as Node | null)) this.toggleSpeedMenu(false);
    });
    this.speedMenu.addEventListener('keydown', (e) => {
      const items = [...this.speedMenu.querySelectorAll('button')];
      const k = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        items[(k + (e.code === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.toggleSpeedMenu(false);
        this.speedBtn.focus();
      }
    });
    // phones: Listening (language, speed, read-along, look) beside Transcript, under the controls
    this.listenBtn = h(
      'button',
      {
        class: 'wq-icon wq-listen-btn',
        type: 'button',
        'aria-expanded': String(this.listenEl.classList.contains('wq-open')),
        'aria-controls': `wq-listen-${this.uid}`,
        onclick: () => this.toggleListen(),
      },
      icon('voice'),
      h('span', { class: 'wq-lbl' }, t('listen.title')),
    ) as HTMLButtonElement;
    this.waitEl = h(
      'div',
      { class: 'wq-wait', 'aria-hidden': 'true' },
      h('bdi', { class: 'wq-mono', dir: 'ltr' }),
      h('span', { class: 'wq-wait-bar' }, h('i')),
      h('span', {}, t('bar.waiting')),
    );
    this.bar.replaceChildren(
      ...([
        this.playBtn,
        this.iconBtn('wq-back', t('bar.back'), 'back', () => this.prev()),
        this.iconBtn('wq-next', t('bar.next'), 'next', () => this.next()),
        this.segsEl,
        // the step, and on phones the speed at its end
        h('div', { class: 'wq-steprow' }, this.stepName, h('bdi', { class: 'wq-steprate wq-mono', dir: 'ltr' })),
        this.waitEl,
        h('div', { class: 'wq-speedwrap' }, this.speedBtn, this.speedMenu),
        this.iconBtn(
          'wq-cc',
          t('bar.captions'),
          'captions',
          () => this.setCaptions(!this.captionsOn),
          { 'aria-pressed': String(this.captionsOn) },
          t('bar.cc'),
        ),
        // the teacher's rating, in the bar where the strip is hidden (the studio's preview)
        this.panel ? this.iconBtn('wq-rate-bar', t('panel.rate'), 'edit', () => this.toggleRating()) : null,
        // on phones (and without the strip) the transcript button sits here, next to the captions; on phones it
        // shares the bottom row with Listening
        h(
          'div',
          { class: 'wq-bottomrow' },
          this.listenBtn,
          this.iconBtn(
            'wq-txt wq-txt-bar',
            t('bar.transcript'),
            'transcript',
            () => this.toggleTranscript(),
            { 'aria-pressed': String(!this.transcriptEl.hidden) },
            t('bar.text'),
          ),
        ),
      ].filter(Boolean) as Node[]),
    );
    this.updateSpeed();
    this.buildSegments();
  }

  /** The timeline: one bar per step, a diamond for each question step (practice ones in grey). */
  private buildSegments() {
    if (!this.segsEl || !this.compiled) return;
    const total = this.compiled.beats.reduce((a, b) => a + Math.max(b.timing.dur, 2), 0);
    this.stepKey = '';
    this.segsEl.replaceChildren(
      ...this.compiled.beats.map((b, i) => {
        const q = !!b.beat.questions?.length;
        const practice = q && (b.beat.card?.label === 'practice' || b.beat.move === 'practice');
        const s = h(
          'button',
          {
            class: `wq-seg${q ? ' wq-seg-q' : ''}${practice ? ' wq-seg-p' : ''}`,
            type: 'button',
            style: q ? {} : { flexGrow: String(Math.max(b.timing.dur, 2) / total) },
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
    // on an Arabic keyboard the letter keys carry Arabic letters: shown beside the Latin one
    const arabic = this.lang === 'ar' || this.lang === 'ary';
    const row = (keys: string[], label: MessageKey) => [
      h(
        'dt',
        {},
        keys.map((k) =>
          h(
            'kbd',
            { dir: 'ltr' },
            k,
            arabic && AR_KEYS[k] ? h('span', { class: 'wq-kbd-ar', lang: 'ar' }, AR_KEYS[k]) : null,
          ),
        ),
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
              row(['<', '>'], 'help.speed'),
              row(['C'], 'help.captions'),
              row(['T'], 'help.transcript'),
              row(['F'], 'help.fullscreen'),
              ...(this.panel ? [row(['R'], 'help.rate')] : []),
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
        h(
          'div',
          { class: 'wq-help-foot' },
          h('p', { class: 'wq-help-close' }, t('help.close')),
          h('button', { type: 'button', class: 'wq-btn', onclick: () => this.helpEl.close() }, t('common.close')),
        ),
      ),
    );
    this.helpEl.addEventListener('click', (e) => {
      if (e.target === this.helpEl) this.helpEl.close();
    });
  }

  private buildTranscript() {
    if (!this.transcriptEl) return;
    const t = this.t;
    const list = h('ol', {});
    this.compiled.beats.forEach((cb, i) => {
      const q = !!cb.beat.questions?.length;
      const li = h(
        'li',
        { 'data-i': String(i) },
        h(
          'button',
          { type: 'button', class: 'wq-tr-beat', onclick: () => this.seek(i, true) },
          h('bdi', { class: 'wq-tr-n', dir: 'ltr' }, String(i + 1)),
          q ? h('span', { class: 'wq-tr-q', 'aria-hidden': 'true' }) : null,
          h('bdi', { class: 'wq-tr-t' }, rich(cb.beat.title)),
          h('span', { class: 'wq-tr-seen' }, `· ${t('transcript.watched')}`),
        ),
        h('p', {}, rich(narrationText(cb.beat.narration))),
      );
      list.append(li);
    });
    this.transcriptEl.setAttribute('aria-labelledby', `wq-tr-${this.uid}`);
    const grip = this.grip(() => this.toggleTranscript());
    const head = h(
      'div',
      { class: 'wq-tr-head' },
      h('h2', { id: `wq-tr-${this.uid}` }, t('transcript.title')),
      // phones: half height or full
      h(
        'button',
        {
          type: 'button',
          class: 'wq-tr-size',
          onclick: () => this.setTrFull(!this.trFull),
        },
        t(this.trFull ? 'transcript.collapse' : 'transcript.expand'),
      ),
      this.iconBtn('', t('transcript.close'), 'close', () => this.toggleTranscript()),
    );
    this.transcriptEl.replaceChildren(grip, head, h('p', { class: 'wq-tr-hint' }, t('transcript.hint')), list);
    // dragged by its handle or head: it stops at half height, then full; down from half closes
    this.dragOffs.get('tr')?.();
    const trOffs = [grip, head].map((g) =>
      dragSheet(g, {
        active: () => !!this.phone?.matches,
        stops: () => {
          const vh = window.innerHeight;
          return [0, Math.min(vh * 0.52, 440), vh - 64];
        },
        height: () => this.transcriptEl.getBoundingClientRect().height,
        follow: (px) => {
          this.transcriptEl.style.height = `${px}px`;
          this.transcriptEl.classList.add('wq-dragging');
        },
        done: (px) => {
          this.transcriptEl.style.height = '';
          this.transcriptEl.classList.remove('wq-dragging');
          if (px === 0) this.toggleTranscript();
          else this.setTrFull(px > Math.min(window.innerHeight * 0.52, 440) + 1);
        },
      }),
    );
    this.dragOffs.set('tr', () => {
      for (const off of trOffs) off();
    });
  }

  /** A bottom sheet's handle (phones): a button that closes it, and what a finger drags. */
  private grip(close: () => void): HTMLElement {
    return h(
      'button',
      // (for fingers: each sheet has its own Close button for the keyboard and screen readers)
      { type: 'button', class: 'wq-grip', 'data-grip': '', tabindex: '-1', 'aria-hidden': 'true', onclick: close },
      h('span', { 'aria-hidden': 'true' }),
    );
  }

  /** Phones: the transcript at half height (the lesson plays on above it) or full (a veil behind it). */
  private setTrFull(full: boolean) {
    if (this.trFull === full) return;
    this.trFull = full;
    this.transcriptEl.classList.toggle('wq-tr-full', full);
    this.root.classList.toggle('wq-veiled', full && !this.transcriptEl.hidden);
    const b = this.transcriptEl.querySelector('.wq-tr-size');
    if (b) b.textContent = this.t(full ? 'transcript.collapse' : 'transcript.expand');
  }

  /** The Listening sheet (phones): the lesson's language, speed, the read-along, Sheet or Board. */
  private buildListen() {
    const t = this.t;
    const titleId = `wq-listen-t-${this.uid}`;
    this.listenEl.id = `wq-listen-${this.uid}`;
    this.listenEl.setAttribute('aria-labelledby', titleId);
    const group = (label: string, id: string, items: HTMLElement[], ltr = false) =>
      h(
        'div',
        { class: 'wq-ls-group' },
        h('p', { class: 'wq-ls-label', id }, label),
        h(
          'div',
          { class: 'wq-ls-radios', role: 'radiogroup', 'aria-labelledby': id, ...(ltr ? { dir: 'ltr' } : {}) },
          items,
        ),
      );
    const radio = (label: string, on: boolean, pick: () => void, extra: Record<string, unknown> = {}) => {
      const b = h(
        'button',
        { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', ...extra },
        h('span', {}, label),
        icon('check', 18),
      );
      b.addEventListener('click', pick);
      return b;
    };
    const langs = this.langs();
    const langRows = langs.map((l) =>
      radio(
        LANG_INFO[l as keyof typeof LANG_INFO]?.name ?? langInfo(l).name,
        l === this.lang,
        () => {
          this.setLang(l);
          // the sheet is drawn again in the new language: the focus stays on the chosen language
          this.listenEl.querySelector<HTMLElement>(`[data-lang="${l}"]`)?.focus();
        },
        { 'data-lang': l, lang: l, dir: dirOf(l), class: 'wq-ls-lang' },
      ),
    );
    const switchId = `wq-ls-ra-${this.uid}`;
    const hintId = `wq-ls-rah-${this.uid}`;
    const readAlong = h(
      'button',
      {
        type: 'button',
        class: 'wq-switch',
        role: 'switch',
        'aria-checked': String(this.captionsOn),
        'aria-labelledby': switchId,
        'aria-describedby': hintId,
        onclick: () => this.setCaptions(!this.captionsOn),
      },
      h('span', { class: 'wq-knob' }),
    );
    this.listenEl.replaceChildren(
      ...([
        this.grip(() => this.toggleListen(false)),
        h(
          'div',
          { class: 'wq-ls-head' },
          h('h2', { id: titleId, tabindex: '-1' }, t('listen.title')),
          this.iconBtn('wq-ls-close', t('common.close'), 'close', () => this.toggleListen(false)),
        ),
        langs.length > 1 ? group(t('listen.lang'), `wq-ls-l-${this.uid}`, langRows) : null,
        group(
          t('speed.title'),
          `wq-ls-s-${this.uid}`,
          SPEEDS.map((r) =>
            radio(this.fmtRate(r), r === this.rate, () => this.setSpeed(r), {
              'data-rate': String(r),
              class: 'wq-seg-r',
            }),
          ),
          true,
        ),
        // with no voice the words under the picture are the narration: nothing to switch
        this.noVoice
          ? null
          : h(
              'div',
              { class: 'wq-ls-switch' },
              h(
                'div',
                {},
                h('p', { class: 'wq-ls-t', id: switchId }, t('listen.readAlong')),
                h('p', { class: 'wq-ls-hint', id: hintId }, t('listen.readAlongHint')),
              ),
              readAlong,
            ),
        group(t('listen.look'), `wq-ls-k-${this.uid}`, [
          radio(t('theme.sheet'), this.theme === 'sheet', () => this.setTheme('sheet'), {
            'data-look': 'sheet',
            class: 'wq-seg-r',
          }),
          radio(t('theme.board'), this.theme !== 'sheet', () => this.setTheme('board'), {
            'data-look': 'board',
            class: 'wq-seg-r',
          }),
        ]),
      ].filter(Boolean) as Node[]),
    );
    this.dragOffs.get('ls')?.();
    this.dragOffs.set(
      'ls',
      dragSheet(this.listenEl.querySelector<HTMLElement>('.wq-grip')!, {
        stops: () => [0, this.listenEl.scrollHeight],
        height: () => this.listenEl.getBoundingClientRect().height,
        follow: (px) => {
          this.listenEl.style.transform = `translateY(${this.listenEl.scrollHeight - px}px)`;
          this.listenEl.classList.add('wq-dragging');
        },
        done: (px) => {
          this.listenEl.style.transform = '';
          this.listenEl.classList.remove('wq-dragging');
          if (px === 0) this.toggleListen(false);
        },
      }),
    );
  }

  /** Open or close the Listening sheet (phones). One sheet at a time: it closes the transcript. */
  toggleListen(open = !this.listenEl.classList.contains('wq-open')): void {
    if (!this.listenEl) return;
    const was = this.listenEl.classList.contains('wq-open');
    if (open === was) return;
    if (open && !this.transcriptEl.hidden) this.toggleTranscript();
    this.listenEl.classList.toggle('wq-open', open);
    this.root.classList.toggle('wq-veiled', open);
    this.listenBtn?.setAttribute('aria-expanded', String(open));
    if (open)
      (
        this.listenEl.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]') ??
        this.listenEl.querySelector<HTMLElement>('h2')
      )?.focus({ preventScroll: true });
    else if (this.listenEl.contains(document.activeElement)) this.listenBtn?.focus({ preventScroll: true });
  }

  /** Inside a sheet: Esc closes it, Tab stays in it, arrows move within a group of choices. */
  private sheetKeys(e: KeyboardEvent) {
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.toggleListen(false);
      return;
    }
    if (e.code === 'Tab') {
      const items = [
        ...this.listenEl.querySelectorAll<HTMLElement>('button:not([tabindex="-1"]), [tabindex="0"]'),
      ].filter((x) => x.offsetParent !== null);
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
      return;
    }
    const radio = (e.target as HTMLElement).closest<HTMLElement>('[role="radio"]');
    const group = radio?.parentElement;
    if (!radio || !group) return;
    const rtl = getComputedStyle(group).direction === 'rtl';
    const all = [...group.querySelectorAll<HTMLElement>('[role="radio"]')];
    const k = all.indexOf(radio);
    const to =
      e.code === 'ArrowDown' || e.code === (rtl ? 'ArrowLeft' : 'ArrowRight')
        ? k + 1
        : e.code === 'ArrowUp' || e.code === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ? k - 1
          : e.code === 'Home'
            ? 0
            : e.code === 'End'
              ? all.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    const next = all[(to + all.length) % all.length];
    next?.click();
    next?.focus();
  }

  /** Fingers on the picture and the caption: tap to pause or play, swipe to turn the page, hold a word. */
  private bindGestures() {
    const viewport = this.frame.parentElement!;
    // controls, cards, pick targets, the start and paused layers, widgets that take input
    const ignore = (t: Element) => {
      const c = t.closest(
        'button, a, input, select, textarea, [role="button"], [role="radio"], [tabindex], .wq-cards, .wq-card, .wq-picks, .wq-cover, .wq-tap',
      );
      // (only what is inside the picture: the player itself takes the focus too)
      return !!c && viewport.contains(c);
    };
    const pickOpen = () => !!this.overlay.querySelector('.wq-picks');
    const turn = (step: 1 | -1) => {
      if (!this.started || this.opts.bare || this.reviewMode) return;
      if (step > 0) this.next();
      else this.prev();
    };
    this.offs.push(
      onSurface(viewport, {
        tap: () => {
          // while a question waits, a tap on the picture is not play or pause; the editor's stage and review frames
          // are still pictures
          if (!this.started || this.opts.bare || this.reviewMode || (this.beat().ask && this.cardShown)) return;
          this.togglePlay();
        },
        swipe: turn,
        ignore,
        dir: () => this.dir,
        swipeOff: pickOpen,
      }),
      onSurface(this.captionEl, { swipe: turn, dir: () => this.dir, swipeOff: pickOpen }),
      onHold(
        this.captionEl,
        '.wq-w',
        (w) => this.sayWord(w),
        () => this.canHold(),
      ),
    );
  }

  /** A word can be heard again on its own when the caption reads along over a recording (not estimated times). */
  private canHold(): boolean {
    const cb = this.beat();
    return this.capWords.length > 0 && !cb.timing.synthetic && !!this.data.audio?.[this.lang]?.[cb.id];
  }

  /** Press and hold a word: the lesson pauses, the word is said again from the recording, a pill shows it. */
  private sayWord(w: HTMLElement) {
    const cb = this.beat();
    const src = this.data.audio?.[this.lang]?.[cb.id];
    const entry = this.capWords.find((c) => c.el.contains(w));
    const words = cb.timing.words;
    if (!src || !entry || !words?.[entry.k]) return;
    const from = words[entry.k]![0];
    const to = words[entry.k + 1]?.[0] ?? cb.timing.dur;
    this.pause();
    for (const id of this.heldTimers) clearTimeout(id);
    this.heldTimers = [];
    this.heldAudio?.pause();
    for (const x of this.captionEl.querySelectorAll('.wq-held')) x.classList.remove('wq-held');
    const a = new Audio(src);
    a.playbackRate = this.rate;
    this.heldAudio = a;
    // from the word's start (once the file can seek), until the sound's own clock reaches the next word
    const start = () => {
      a.currentTime = from;
      void a.play().catch(() => {});
    };
    if (a.readyState >= 1) start();
    else a.addEventListener('loadedmetadata', start, { once: true });
    a.addEventListener('timeupdate', () => {
      if (a.currentTime >= to - 0.02) a.pause();
    });
    // (timeupdate is coarse: a safety stop once it plays)
    a.addEventListener(
      'playing',
      () => this.heldTimers.push(setTimeout(() => a.pause(), ((to - a.currentTime) / this.rate) * 1000 + 60)),
      { once: true },
    );
    const ms = Math.max(250, ((to - from) / this.rate) * 1000);
    const word = (w.textContent ?? '').trim();
    entry.el.classList.add('wq-held');
    this.wordPill.replaceChildren(icon('voice', 16), h('span', {}, word));
    this.wordPill.hidden = false;
    this.live.textContent = this.t('word.again', { word });
    navigator.vibrate?.(10);
    this.heldTimers.push(
      setTimeout(() => {
        this.wordPill.hidden = true;
        entry.el.classList.remove('wq-held');
      }, ms + 1000),
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
    this.usePalette();
    this.stopAudio();
    this.closeCard();
    // the step being left was seen (the transcript marks it; a jump does not mark the ones skipped)
    if (this.started && i !== this.i) this.seen.add(this.i);
    this.i = i;
    this.time = 0;
    this.resting = false;
    this.extra.clear();
    this.cardShown = false;
    const cb = this.beat();
    // a beat's layout continues the previous one (nodes that stay or fade out): build that first when jumping
    if (i > 0 && this.builtIndex !== i - 1) {
      const prev = this.compiled.beats[i - 1]!;
      this.renderer.build(prev, this.layoutPlace(prev));
    }
    if (i === 0) this.renderer.boxes = new Map();
    this.renderer.build(cb, this.layoutPlace(cb));
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
    this.resting = false;
    this.setPlaying(true);
    const cb = this.beat();
    const src = this.data.audio?.[this.lang]?.[cb.id];
    if (src && !this.audioFailed && this.time < cb.timing.dur) {
      if (!this.audio) {
        this.audio = new Audio(src);
        this.audio.preload = 'auto';
        this.audio.playbackRate = this.rate;
        if (this.time > 0.05) this.audio.currentTime = this.time;
      }
      // the "never started" clock counts from this play (after a tap the file may still be loading)
      this.audioStartedAt = performance.now();
      const audio = this.audio;
      audio
        .play()
        .then(() => this.setSoundBlocked(false))
        .catch((e: unknown) => {
          const name = (e as { name?: string } | null)?.name;
          // a play() cut short by a pause, a seek or a new beat (AbortError), or one for a sound already replaced:
          // nothing failed
          if (name === 'AbortError' || audio !== this.audio) return;
          // the browser wants a tap first (autoplay): wait for it; anything else: go on without sound
          if (name === 'NotAllowedError') this.setSoundBlocked(true);
          else this.soundFailed();
        });
    } else this.setSoundBlocked(false);
    this.prefetch();
    this.lastNow = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame((n) => this.frameTick(n));
  }

  pause(): void {
    this.audio?.pause();
    this.setPlaying(false);
  }

  /**
   * Show beat `i` at `t` seconds (its rest by default), paused, without the start screen: the studio's editor draws
   * the beat it edits. Questions are not opened. Playing from there starts the beat over (`resting`).
   */
  showAt(i: number, t?: number): void {
    if (i < 0 || i >= this.compiled.beats.length) return;
    this.started = true;
    this.cover.hidden = true;
    if (i !== this.i || this.playing) this.seek(i, false);
    this.stopAudio();
    this.closeCard();
    this.cardShown = false;
    this.extra.clear();
    this.time = Math.max(0, Math.min(t ?? this.restTime(i), this.beat().end));
    this.resting = true;
    this.render();
  }

  /** Shown by `showAt` and not played since: playing the beat starts it from the beginning. */
  resting = false;

  /**
   * Where a beat rests in the editor: the latest moment that shows the most of it (every part shown, drawn and
   * faded in), so animations have finished but cues near its end that clear the stage for the next beat have not.
   */
  restTime(i: number): number {
    const cb = this.compiled.beats[i];
    if (!cb) return 0;
    const leaving = new Set(cb.leaving);
    let best = -1;
    let at = 0;
    for (let t = 0; t <= cb.end + 1e-6; t += 0.1) {
      const get = sampler(cb, t);
      let score = 0;
      for (const id of cb.start.order) {
        if (leaving.has(id)) continue;
        const o = Number(get(id, '', 'o') ?? 0) * Number(get(id, '', 'd') ?? 1);
        if (o <= 0.01) continue;
        score += o;
        for (const sub of Object.keys(cb.start.nodes[id]!.subs))
          score += o * Number(get(id, sub, 'o') ?? 0) * Number(get(id, sub, 'd') ?? 1);
      }
      if (score > best + 1e-3) {
        best = score;
        at = t;
      } else if (score >= best - 1e-3) at = t;
    }
    return at;
  }

  /**
   * Where a node or one of its parts ("eq#tok:0") is on the screen now, in client pixels: the studio's editor draws
   * a thread from a mark to it. Null when it is not on the stage (or fades out in this beat).
   */
  targetRect(target: string): { left: number; top: number; width: number; height: number } | null {
    const i = target.indexOf('#');
    const node = i < 0 ? target : target.slice(0, i);
    const sub = i < 0 ? '' : target.slice(i + 1);
    const box =
      (sub ? this.renderer.partBox(node, sub) : null) ?? this.renderer.layoutBoxes().find((b) => b.id === node)?.box;
    if (!box) return null;
    const r = this.frame.getBoundingClientRect();
    const k = r.width / 1600;
    return { left: r.left + box.x * k, top: r.top + box.y * k, width: box.w * k, height: box.h * k };
  }

  /** The stage alone (no strip, captions or bar), or the whole player: the editor lifts its stage into one. */
  setBare(on: boolean): void {
    this.opts.bare = on;
    this.root.classList.toggle('wq-bare', on);
    // the bare stage (the editor) says nothing about voices
    this.noVoice = !on && !Object.keys(this.data.audio?.[this.lang] ?? {}).length;
    this.voiceNote.hidden = !this.noVoice;
    this.setCaptions(this.captionsOn, false);
    this.placeCards(true);
    this.setPlaying(this.playing);
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
    // the stage alone (the studio's editor, video frames) has no bar to resume from: no "Paused" note on it
    this.pausedEl.hidden =
      v || !this.started || this.reviewMode || !!this.opts.bare || this.beat().ask || this.soundBlocked;
    if (this.playBtn) this.playBtn.replaceChildren(icon(v ? 'pause' : 'play'));
    if (!v) cancelAnimationFrame(this.raf);
  }

  private soundFailed() {
    this.audioFailed = true;
    this.soundNote.hidden = false;
  }

  /** Sound refused until a tap: the clock stops (the narration and the picture stay together), the picture dims. */
  private setSoundBlocked(v: boolean) {
    if (this.soundBlocked === v) return;
    this.soundBlocked = v;
    this.root.classList.toggle('wq-sound-blocked', v);
    const had = this.tapEl.contains(document.activeElement);
    this.tapEl.hidden = !v;
    if (v) {
      this.setPlaying(false);
      this.tapEl.querySelector('button')?.focus({ preventScroll: true });
    } else if (had) this.playBtn?.focus({ preventScroll: true });
  }

  private stopAudio() {
    // a word heard again stops with the lesson's sound
    if (this.heldAudio) {
      this.heldAudio.pause();
      this.heldAudio.removeAttribute('src');
      this.heldAudio = null;
    }
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
      this.time += dt * this.rate;
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
    // the bar follows at once (the clock may have stopped for the question)
    this.updateUi();
  }

  /** Draw the picture at the current time. */
  render(): void {
    this.usePalette();
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
        segs[k]!.classList.toggle('wq-past', k < this.i);
      }
    }
    const key = `${this.i}:${this.lang}`;
    if (this.stepName && key !== this.stepKey) {
      this.stepKey = key;
      this.stepName.replaceChildren(
        h(
          'bdi',
          { class: 'wq-mono', dir: 'ltr' },
          this.t('bar.stepOf', { i: this.i + 1, n: this.compiled.beats.length }),
        ),
        h('span', { class: 'wq-sep', 'aria-hidden': 'true' }, '·'),
        h('bdi', { class: 'wq-stepname-t' }, rich(cb.beat.title)),
      );
    }
    if (this.captionsOn || this.noVoice) this.updateCaption(cb);
    const cur = this.transcriptEl.querySelector('li.wq-cur');
    if (cur?.getAttribute('data-i') !== String(this.i)) {
      cur?.classList.remove('wq-cur');
      for (const li of this.transcriptEl.querySelectorAll<HTMLElement>('li[data-i]')) {
        const n = Number(li.dataset.i);
        li.classList.toggle('wq-seen', n !== this.i && this.seen.has(n));
      }
      const now = this.transcriptEl.querySelector(`li[data-i="${this.i}"]`);
      now?.classList.add('wq-cur');
      // the current step stays in the middle of the list as the lesson plays
      if (!this.transcriptEl.hidden) now?.scrollIntoView?.({ block: this.playing ? 'center' : 'nearest' });
    }
    // phones: while a question waits under the picture, the controls give way to where you are
    const waiting = !!(
      cb.ask &&
      this.cardShown &&
      this.cardsOut &&
      cb.beat.questions?.length &&
      !this.cardHost.querySelector('.wq-finish')
    );
    this.root.classList.toggle('wq-asking', waiting);
    if (waiting && this.waitEl) {
      (this.waitEl.firstChild as HTMLElement).textContent = this.t('bar.stepOf', {
        i: this.i + 1,
        n: this.compiled.beats.length,
      });
      (this.waitEl.querySelector('i') as HTMLElement).style.width =
        `${((this.i + 1) / this.compiled.beats.length) * 100}%`;
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
        // the last step's question: Continue is the end of the lesson
        done: () => (this.i < this.compiled.beats.length - 1 ? this.next() : this.finishCard()),
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

  /** The finish score on a phone: "4 of 5" with the numbers large, then checks and practice as diamonds. */
  private bigScore(
    right: number,
    total: number,
    sum: (k: 'check' | 'practice') => { r: number; n: number },
  ): HTMLElement {
    const t = this.t;
    const fmt = (n: number) => formatNumber(n, this.lang, { digits: this.data.book?.digits ?? 'latn' });
    // the words between the numbers come from the catalog ("{right} of {total}", "{right} من {total}")
    const parts = t('finish.scoreNum', { right: '@R@', total: '@T@' }).split(/(@R@|@T@)/);
    // said as one sentence; the large drawing of it is for the eyes
    const said = h('p', { class: 'wq-sr' }, t('finish.score', { right, total }));
    const num = h(
      'p',
      { class: 'wq-fin-big', 'aria-hidden': 'true' },
      parts.map((x) =>
        x === '@R@'
          ? h('span', { class: 'wq-fin-n' }, fmt(right))
          : x === '@T@'
            ? h('span', { class: 'wq-fin-n' }, fmt(total))
            : x.trim()
              ? h('span', { class: 'wq-fin-of' }, x.trim())
              : null,
      ),
    );
    const rows = (['check', 'practice'] as const)
      .map((k) => ({ k, s: sum(k) }))
      .filter((x) => x.s.n)
      .map(({ k, s: sc }) => [
        h('dt', {}, t(k === 'check' ? 'finish.checks' : 'finish.practice')),
        h(
          'dd',
          {},
          h(
            'span',
            { class: 'wq-diamonds', 'aria-hidden': 'true' },
            Array.from({ length: Math.min(sc.n, 12) }, (_, i) => h('i', { class: i < sc.r ? 'wq-dia-on' : '' })),
          ),
          h('bdi', { class: 'wq-fin-count' }, t('quiz.progress', { k: sc.r, n: sc.n })),
        ),
      ]);
    return h(
      'div',
      { class: 'wq-fin-phone' },
      said,
      num,
      h('p', { class: 'wq-fin-label', 'aria-hidden': 'true' }, t('finish.scoreLabel')),
      rows.length ? h('dl', { class: 'wq-fin-dl' }, rows.flat()) : null,
    );
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
    const learner = this.opts.learner;
    let card: HTMLElement;
    /** What Enter does on the card when no button has the focus. */
    let enter: (() => void) | null = null;
    if (learner) {
      card = this.learnerCard(learner, right, total, sum);
      // never the costed "Make chapter": nothing is spent without a click on that very button
      enter = () => {
        const go = card.querySelector<HTMLElement>('.wq-nextch-go[aria-keyshortcuts]');
        go?.click();
      };
    } else {
      const lesson = this.lesson;
      const next = this.data.book?.next;
      const home = this.data.book?.home;
      card = h(
        'section',
        { class: 'wq-card wq-card-screen wq-finish', role: 'region', 'aria-label': t('finish.titleNoChapter') },
        h('div', { class: 'wq-mascot', 'aria-hidden': 'true' }, markIcon(120)),
        h('h2', {}, lesson.number !== undefined ? t('finish.title', { n: lesson.number }) : t('finish.titleNoChapter')),
        h('p', { class: 'wq-finish-sub' }, lesson.title),
        total
          ? h('p', { class: 'wq-finish-score' }, t('finish.score', { right, total }))
          : h('p', {}, t('finish.noScore')),
        // phones: the score large, then each kind of question with a diamond per question
        total ? this.bigScore(right, total, sum) : null,
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
          next
            ? h(
                'a',
                { class: 'wq-btn wq-primary', href: next, 'aria-keyshortcuts': 'Enter' },
                t('finish.next'),
                icon('next'),
              )
            : null,
          h(
            'button',
            { type: 'button', class: 'wq-btn', onclick: () => this.restart(), 'aria-keyshortcuts': 'R' },
            icon('restart'),
            t('finish.again'),
          ),
          home ? h('a', { class: 'wq-btn', href: home }, icon('book'), t('finish.contents')) : null,
        ),
      );
      if (next)
        enter = () => {
          location.href = next;
        };
    }
    this.cardHost.replaceChildren(card);
    this.live.textContent = `${t('finish.titleNoChapter')}. ${total ? t('finish.score', { right, total }) : ''}`;
    // the learner's card takes the focus on its title, or on a button that costs nothing (open a chapter already
    // made): a key pressed as the lesson ends must never press "Make chapter · about $x"
    const focusTo = learner
      ? (card.querySelector<HTMLElement>('.wq-nextch-go[aria-keyshortcuts]') ?? card.querySelector<HTMLElement>('h2'))
      : card.querySelector<HTMLElement>('.wq-primary');
    if (focusTo?.tagName === 'H2') focusTo.tabIndex = -1;
    focusTo?.focus();
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
        const target = e.target as HTMLElement | null;
        const onControl = learner
          ? !!target?.closest?.('button, a, input, select, textarea')
          : target?.tagName === 'BUTTON';
        if ((e.code === 'Enter' || e.code === 'NumpadEnter') && enter && !onControl) {
          enter();
          return true;
        }
        return false;
      },
      destroy: () => {
        card.remove();
        if (this.nextEl && card.contains(this.nextEl)) this.nextEl = null;
      },
    };
  }

  /**
   * The finish card of someone learning on their own (the studio): the score on the highlighter, "How was this
   * chapter?", the questions to review, and the next chapter (open it, or make it at a stated cost).
   */
  private learnerCard(
    learner: LearnerOptions,
    right: number,
    total: number,
    sum: (k: 'check' | 'practice') => { r: number; n: number },
  ): HTMLElement {
    const t = this.t;
    const lesson = this.lesson;
    const fmt = (n: number) => formatNumber(n, this.lang, { digits: this.data.book?.digits ?? 'latn' });
    // questions answered wrong on the first try, and the first step that asks one of them
    let missed = 0;
    let missedAt = -1;
    this.compiled.beats.forEach((b, i) => {
      for (const q of b.beat.questions ?? []) {
        const s = this.scores[q.id];
        if (!s || s.right >= s.total) continue;
        missed++;
        if (missedAt < 0) missedAt = i;
      }
    });
    const head = h(
      'div',
      { class: 'wq-fin-head' },
      h('div', { class: 'wq-fin-tile wq-mascot', 'aria-hidden': 'true' }, markIcon(96)),
      h(
        'div',
        { class: 'wq-fin-titles' },
        h('h2', {}, lesson.number !== undefined ? t('finish.title', { n: lesson.number }) : t('finish.titleNoChapter')),
        h('p', { class: 'wq-fin-sub', dir: 'auto' }, lesson.title),
      ),
    );
    const score = total
      ? h(
          'p',
          { class: 'wq-fin-score' },
          // the numbers in the mono font; the word between them ("من") in the interface font
          h(
            'span',
            { class: 'wq-fin-num' },
            this.tNodes(
              'finish.scoreNum',
              {},
              {
                right: h('span', { class: 'wq-mono' }, fmt(right)),
                total: h('span', { class: 'wq-mono' }, fmt(total)),
              },
            ),
          ),
          h('span', { class: 'wq-fin-label' }, t('finish.scoreLabel')),
        )
      : h('p', { class: 'wq-fin-score' }, h('span', { class: 'wq-fin-label' }, t('finish.noScore')));
    const stats = total
      ? h(
          'ul',
          { class: 'wq-fin-stats' },
          (['check', 'practice'] as const).map((k) => {
            const s = sum(k);
            return s.n
              ? h(
                  'li',
                  { class: `wq-fin-${k}` },
                  t(k === 'check' ? 'finish.checks' : 'finish.practice'),
                  ' ',
                  h('bdi', { class: 'wq-mono', dir: 'ltr' }, `${fmt(s.r)}/${fmt(s.n)}`),
                )
              : null;
          }),
        )
      : null;
    const review =
      missed > 0
        ? h(
            'button',
            {
              type: 'button',
              class: 'wq-review',
              onclick: () => {
                this.root.focus({ preventScroll: true });
                this.seek(missedAt, true);
              },
            },
            h('span', { class: 'wq-review-tile', 'aria-hidden': 'true' }, markIcon(30)),
            h(
              'span',
              { class: 'wq-review-t' },
              h('strong', {}, t('finish.review', { n: missed })),
              h('small', {}, t('finish.reviewHint', { n: missed })),
            ),
            icon('next', 24),
          )
        : null;
    const more = h(
      'div',
      { class: 'wq-fin-more' },
      h(
        'button',
        {
          type: 'button',
          class: 'wq-btn',
          onclick: () => {
            this.root.focus({ preventScroll: true });
            this.restart();
          },
          'aria-keyshortcuts': 'R',
        },
        icon('restart'),
        t('finish.again'),
      ),
      learner.home
        ? h(
            'button',
            { type: 'button', class: 'wq-btn wq-btn-text', onclick: () => learner.home?.() },
            icon('book'),
            t('finish.allChapters'),
          )
        : null,
    );
    return h(
      'section',
      {
        class: 'wq-card wq-card-screen wq-finish wq-finish-learn',
        role: 'region',
        'aria-label': t('finish.titleNoChapter'),
      },
      h('div', { class: 'wq-fin-a' }, head, score, stats),
      h(
        'div',
        { class: 'wq-fin-b' },
        learner.onFeedback ? this.feelBox(learner) : null,
        review,
        learner.next ? this.nextPanel(learner.next) : null,
        more,
      ),
    );
  }

  /** "How was this chapter?": too easy, about right or too hard (one choice; it can be changed). */
  private feelBox(learner: LearnerOptions): HTMLElement {
    const t = this.t;
    const choices: [LearnerFeedback, MessageKey, MessageKey][] = [
      ['too-easy', 'finish.feel.easy', 'finish.feel.easyDone'],
      ['right', 'finish.feel.right', 'finish.feel.rightDone'],
      ['too-hard', 'finish.feel.hard', 'finish.feel.hardDone'],
    ];
    const note = h('span', { class: 'wq-feel-note' });
    const level = h('span', { class: 'wq-feel-level' });
    const show = () => {
      const said = choices.find(([f]) => f === this.feel);
      note.textContent = t(said ? said[2] : 'finish.feel.pending');
      const words = this.feelLevel ?? learner.level;
      level.hidden = !words;
      level.textContent = words ? t('finish.feel.levelNow', { level: words }) : '';
    };
    const buttons: HTMLButtonElement[] = choices.map(([f, key]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'wq-feel-btn',
          'aria-pressed': String(this.feel === f),
          onclick: () => {
            this.feel = f;
            buttons.forEach((b, k) => {
              b.setAttribute('aria-pressed', String(choices[k]![0] === f));
            });
            show();
            // the host may answer with the new level's words, now or later; only the last choice counts
            const ask = ++this.feelAsk;
            let answer: ReturnType<NonNullable<LearnerOptions['onFeedback']>>;
            try {
              answer = learner.onFeedback?.(f);
            } catch (err) {
              console.warn('[warqa] learner.onFeedback failed', err);
              return;
            }
            Promise.resolve(answer).then(
              (words) => {
                if (ask !== this.feelAsk || typeof words !== 'string' || !words) return;
                this.feelLevel = words;
                show();
              },
              (err) => console.warn('[warqa] learner.onFeedback failed', err),
            );
          },
        },
        t(key),
      ),
    );
    show();
    return h(
      'fieldset',
      { class: 'wq-feel' },
      h('legend', {}, t('finish.feel.title')),
      h('div', { class: 'wq-feel-opts' }, buttons),
      h('p', { class: 'wq-feel-foot', 'aria-live': 'polite' }, note, level),
    );
  }

  /**
   * A message with elements in place of some placeholders: a number in the mono font, a title in its own
   * direction, a price that stays left to right. The words around them stay in the catalog's order.
   */
  private tNodes(key: MessageKey, params: Params, nodes: Record<string, Node>): (string | Node)[] {
    const names = Object.keys(nodes);
    const marked: Params = { ...params };
    // private-use characters stand for the elements while the catalog fills in the rest
    names.forEach((name, k) => {
      marked[name] = String.fromCharCode(0xe000 + k);
    });
    const out: (string | Node)[] = [];
    let run = '';
    for (const ch of this.t(key, marked)) {
      const k = ch.charCodeAt(0) - 0xe000;
      if (k >= 0 && k < names.length) {
        if (run) out.push(run);
        run = '';
        out.push(nodes[names[k]!]!);
      } else run += ch;
    }
    if (run) out.push(run);
    return out;
  }

  /** The next chapter: its number and title, then make it (or open it), and how its making goes. */
  private nextPanel(next: NonNullable<LearnerOptions['next']>): HTMLElement {
    const t = this.t;
    const fmt = (n: number) => formatNumber(n, this.lang, { digits: this.data.book?.digits ?? 'latn' });
    const kid = `wq-nextch-k-${this.uid}`;
    const tid = `wq-nextch-t-${this.uid}`;
    const act = h('div', { class: 'wq-nextch-act', 'aria-live': 'polite' });
    const panel = h(
      'div',
      { class: 'wq-nextch', role: 'group', 'aria-labelledby': next.made ? tid : `${kid} ${tid}` },
      // a chapter already made: the button says "Next chapter", the label above would repeat it
      next.made ? null : h('p', { class: 'wq-nextch-k', id: kid }, t('finish.nextKicker')),
      h(
        'p',
        { class: 'wq-nextch-t', id: tid },
        this.tNodes(
          'finish.nextTitle',
          {},
          {
            n: h('bdi', { class: 'wq-mono wq-nextch-n', dir: 'ltr' }, fmt(next.n)),
            title: h('bdi', { dir: 'auto' }, next.title),
          },
        ),
      ),
      act,
      next.made ? null : h('p', { class: 'wq-nextch-hint' }, t('finish.makeHint')),
    );
    this.nextEl = act;
    this.renderNext(null);
    return panel;
  }

  /** The host reports the next chapter being made from the finish card. */
  learnerNext(state: LearnerNextState): void {
    const was = this.nextState.status;
    this.nextState = state;
    this.renderNext(was);
  }

  /** Draw the next chapter's action for its state; `was` is the state it replaces (null: a new card). */
  private renderNext(was: LearnerNextState['status'] | null) {
    const act = this.nextEl;
    const next = this.opts.learner?.next;
    if (!act || !next || this.destroyed) return;
    const t = this.t;
    const s = this.nextState;
    const pct = s.status === 'making' && typeof s.pct === 'number' ? Math.max(0, Math.min(100, s.pct)) : undefined;
    // progress only moves the bar: the words (and what a screen reader says) change with the state alone
    if (s.status === 'making' && was === 'making') {
      const bar = act.querySelector<HTMLElement>('.wq-nextch-bar');
      if (bar) {
        bar.classList.toggle('wq-indet', pct === undefined);
        if (pct === undefined) bar.removeAttribute('aria-valuenow');
        else bar.setAttribute('aria-valuenow', String(Math.round(pct)));
        (bar.firstElementChild as HTMLElement).style.width = pct === undefined ? '' : `${pct}%`;
        return;
      }
    }
    const active = act.ownerDocument.activeElement;
    const hadFocus = was !== null && (act.contains(active) || !active || active === act.ownerDocument.body);
    const hint = act.parentElement?.querySelector<HTMLElement>('.wq-nextch-hint');
    if (hint) hint.hidden = s.status === 'making' || s.status === 'ready';
    const go = (label: (string | Node)[], run: () => void, keyed: boolean, ico: 'play' | 'next') =>
      h(
        'button',
        {
          type: 'button',
          class: 'wq-btn wq-primary wq-nextch-go',
          'aria-keyshortcuts': keyed ? 'Enter' : undefined,
          onclick: run,
        },
        ico === 'play' ? icon('play') : null,
        h('span', {}, label),
        ico === 'next' ? icon('next') : null,
      );
    const start = () =>
      next.made
        ? go([t('finish.next')], () => next.run(), true, 'next')
        : go(
            next.cost
              ? this.tNodes(
                  'finish.make',
                  { n: next.n },
                  { cost: h('bdi', { class: 'wq-mono', dir: 'ltr' }, next.cost) },
                )
              : [t('finish.makeNoCost', { n: next.n })],
            () => next.run(),
            false,
            'play',
          );
    act.dataset.status = s.status;
    if (s.status === 'making') {
      const fill = h('i', {});
      if (pct !== undefined) fill.style.width = `${pct}%`;
      act.replaceChildren(
        h('p', { class: 'wq-nextch-status', tabindex: '-1' }, t('finish.making', { n: next.n })),
        h(
          'div',
          {
            class: `wq-nextch-bar${pct === undefined ? ' wq-indet' : ''}`,
            role: 'progressbar',
            'aria-label': t('finish.making', { n: next.n }),
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-valuenow': pct === undefined ? undefined : String(Math.round(pct)),
          },
          fill,
        ),
      );
    } else if (s.status === 'ready') {
      act.replaceChildren(
        h('p', { class: 'wq-nextch-status wq-nextch-ok' }, icon('check'), t('finish.ready', { n: next.n })),
        go([t('finish.open')], () => s.open(), true, 'next'),
      );
    } else if (s.status === 'error') {
      act.replaceChildren(
        h('p', { class: 'wq-nextch-status wq-nextch-err' }, icon('error'), h('span', { dir: 'auto' }, s.message)),
        start(),
      );
    } else act.replaceChildren(start());
    // the button that had the focus is gone: keep it on what replaced it
    if (hadFocus && act.isConnected)
      (act.querySelector('button') ?? act.querySelector<HTMLElement>('[tabindex]'))?.focus({ preventScroll: true });
  }

  /* ---------- chrome toggles ---------- */

  /**
   * The sentence being spoken, under the stage. With word times it reads along: words already said in the text
   * colour, the spoken word on the highlighter, words to come muted.
   */
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
      this.capK = -2;
      this.captionEl.replaceChildren();
      const cap = ci >= 0 ? (caps[ci]?.[1] ?? '') : '';
      const words = cb.timing.words;
      const clean = words?.length ? spokenText(cb.beat.narration).clean : '';
      const sentence = clean ? splitSentences(clean)[ci] : undefined;
      if (cap && words?.length && sentence && sentence.text === cap) {
        const list = splitWords(clean).filter((x) => x.start >= sentence.start && x.end <= sentence.end);
        if (list[0] && list[0].start > sentence.start)
          this.captionEl.append(clean.slice(sentence.start, list[0].start));
        list.forEach((w, n) => {
          // a word keeps the punctuation and space after it, so said text reads as one colour
          const gapEnd = list[n + 1]?.start ?? sentence.end;
          const el = h(
            'span',
            {},
            h('span', { class: 'wq-w' }, clean.slice(w.start, w.end)),
            clean.slice(w.end, gapEnd),
          );
          const k = words.findIndex(([, a]) => a === w.start);
          if (k >= 0) this.capWords.push({ k, el });
          this.captionEl.append(el);
        });
      } else this.captionEl.textContent = cap;
      this.captionEl.classList.toggle('wq-rw', this.capWords.length > 0);
      this.captionEl.classList.toggle('wq-empty', !cap);
    }
    if (this.capWords.length) {
      const k = wordAt(cb.timing.words, this.time, cb.timing.dur);
      if (k !== this.capK) {
        this.capK = k;
        for (const w of this.capWords) {
          w.el.classList.toggle('wq-said', w.k < k);
          w.el.classList.toggle('wq-now', w.k === k);
        }
      }
    }
  }

  setCaptions(on: boolean, remember = true): void {
    this.captionsOn = on;
    this.capKey = '';
    // with no voice the captions stay: they are what is said
    this.captionEl.hidden = !(on || this.noVoice);
    if (remember)
      try {
        localStorage.setItem(CAPTIONS_KEY, on ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
    this.bar.querySelector('.wq-cc')?.setAttribute('aria-pressed', String(on));
    this.listenEl?.querySelector('.wq-switch')?.setAttribute('aria-checked', String(on));
    // with no voice the captions cannot be turned off: no button for it
    this.bar.querySelector<HTMLElement>('.wq-cc')?.toggleAttribute('hidden', this.noVoice);
    this.render?.call(this);
  }

  /** The transcript is a side sheet that pushes the stage (a bottom sheet on phones); the stage scales down. */
  toggleTranscript(): void {
    if (this.transcriptEl.hidden) this.toggleListen(false);
    this.transcriptEl.hidden = !this.transcriptEl.hidden;
    const open = !this.transcriptEl.hidden;
    this.root.classList.toggle('wq-with-transcript', open);
    // phones: it opens at half height; the veil only behind the full height
    if (!open) this.setTrFull(false);
    this.root.classList.toggle('wq-veiled', open && this.trFull);
    for (const b of this.root.querySelectorAll('.wq-txt')) b.setAttribute('aria-pressed', String(open));
    if (open) {
      const cur = this.transcriptEl.querySelector('li.wq-cur');
      cur?.scrollIntoView?.({ block: 'nearest' });
      (cur?.querySelector('button') as HTMLElement | null)?.focus();
    } else if (this.transcriptEl.contains(document.activeElement)) {
      const btn = [...this.root.querySelectorAll<HTMLElement>('.wq-txt')].find((b) => b.offsetParent !== null);
      (btn ?? this.root).focus();
    }
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
    else {
      // reading the list pauses the lesson (it does not start again by itself)
      if (this.playing) this.pause();
      this.helpEl.showModal();
    }
  }

  toggleFull(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void this.root.requestFullscreen?.();
  }

  /* ---------- keyboard ---------- */

  private keyHandler(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.helpEl.open || this.panel?.open) return;
    // the Listening sheet is modal: the lesson's keys wait behind it (Esc closes it wherever the focus is)
    if (this.listenEl.classList.contains('wq-open')) {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.toggleListen(false);
      }
      return;
    }
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
    else if (e.code === 'KeyC' && !this.noVoice) this.setCaptions(!this.captionsOn);
    else if (e.key === '<' || e.key === '>') {
      // slower or faster, said aloud
      const k = SPEEDS.indexOf(this.rate) + (e.key === '>' ? 1 : -1);
      const r = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, k))]!;
      this.setSpeed(r);
      this.live.textContent = this.t('speed.now', { rate: this.fmtRate(r) });
    } else if (e.code === 'KeyR' && this.panel && !asking) this.toggleRating();
    else if (e.code === 'KeyT' && !asking) this.toggleTranscript();
    else if (e.code === 'KeyF' && !asking) this.toggleFull();
    else if (e.code === 'Escape' && this.speedMenu && !this.speedMenu.hidden) this.toggleSpeedMenu(false);
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
        JSON.stringify({ ...p, last: this.skeleton.id, lang: this.lang, at: [this.i + 1, this.compiled.beats.length] }),
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
    for (const off of [...this.offs, ...this.dragOffs.values()]) off();
    for (const id of this.heldTimers) clearTimeout(id);
    this.heldAudio?.pause();
    this.phone?.removeEventListener?.('change', this.onPhone);
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.stopAudio();
    cancelAnimationFrame(this.raf);
    (this.opts.keyboard === 'local' ? this.root : window).removeEventListener(
      'keydown',
      this.keyHandler as EventListener,
    );
    this.root.remove();
  }
}
