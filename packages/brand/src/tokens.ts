// The "Cahier" design tokens: a Moroccan school notebook (royal-blue ink, cool paper, Seyès ruling, the red
// margin line, a yellow highlighter on the word being said). This file is the one source: the build writes
// tokens.css from it, and TypeScript code (exported books' icons and manifests, later the player's themes)
// reads the same values. Specification: REDESIGN.md, "Design system specification".

/** A value in the light scheme (Sheet) and in the dark one (Board). */
export type Pair = readonly [light: string, dark: string];

/**
 * Interface colours; CSS variables `--wq-<name>`. Three values moved a hair from the canvas to pass WCAG
 * (src/brand.test.ts checks every pair): text-3 #687091 → #676F90 on the ground, the dark input border
 * #5A6396 → #676F9E (3:1), and the Sheet stage's coral text #D2492F → #D0482F.
 */
export const COLORS = {
  /** page / desk */
  ground: ['#F4F6FA', '#0E1226'],
  /** cards, sheets, stage */
  sheet: ['#FFFFFF', '#171C36'],
  /** menus, dialogs, inputs */
  raised: ['#FFFFFF', '#20264A'],
  text: ['#13172E', '#EEF0FA'],
  'text-2': ['#4A5170', '#B4BAD8'],
  /** captions, words still to come */
  'text-3': ['#676F90', '#8A91B4'],
  /** primary buttons, links, brand */
  ink: ['#2A3CD1', '#8C9BFF'],
  'ink-hover': ['#1E2C9E', '#B9C2FF'],
  /** text on ink buttons */
  'on-ink': ['#FFFFFF', '#0E1226'],
  /** selected rows and chips */
  'ink-tint': ['#EEF0FD', '#232A55'],
  /** card borders */
  line: ['#DCE2F2', '#2C3360'],
  /** ruling, hairlines */
  seyes: ['#D6DEF3', '#1E2444'],
  /** secondary buttons */
  'control-border': ['#B9C6EA', '#3A4278'],
  /** inputs (3:1 against the sheet) */
  'input-border': ['#7F8AB0', '#676F9E'],
  /** the margin rule */
  margin: ['#E0454F', '#FF7A82'],
  /** errors, red-pen notes */
  pen: ['#C22A35', '#FF7A82'],
  'pen-tint': ['#FDECEE', '#3A1E2C'],
  /** the highlighter: only the spoken word, the current step or beat, marks in the editor */
  fluo: ['#FFE14A', '#FFE14A'],
  /** text on the highlighter, in both schemes */
  'on-fluo': ['#13172E', '#13172E'],
  /** running status, unselected marks */
  'fluo-tint': ['#FFF4B8', '#4A4320'],
  /** text in "running" pills */
  'fluo-text': ['#5C4A00', '#FFE14A'],
  /** right answers, always with an icon and a word */
  good: ['#0F7A55', '#5FD3A0'],
  'good-tint': ['#E7F5EF', '#173A30'],
  /** the logo's sheet: ink on paper, light on the Board */
  mark: ['#2A3CD1', '#EEF0FA'],
} as const satisfies Record<string, Pair>;

export type ColorName = keyof typeof COLORS;

/**
 * Surfaces that stay dark in both schemes (the studio's activity board, later the player's Board): the dark
 * column of these colours, as `--wq-board-<name>` everywhere.
 */
export const BOARD_COLORS = [
  'ground',
  'sheet',
  'raised',
  'text',
  'text-2',
  'text-3',
  'ink',
  'line',
  'fluo',
  'on-fluo',
  'good',
  'pen',
] as const satisfies readonly ColorName[];

/** The stage colours lessons name (packages/lesson/src/schema/common.ts), per theme: [text, fill]. */
export const STAGE = {
  sheet: {
    chalk: ['#13172E', '#13172E'],
    dim: ['#4A5170', '#4A5170'],
    faint: ['#8A93B5', '#D6DEF3'],
    task: ['#7A5A00', '#FFE14A'],
    good: ['#0F7A55', '#0F7A55'],
    bad: ['#C22A35', '#C22A35'],
    board: ['#FFFFFF', '#FFFFFF'],
    sky: ['#2A3CD1', '#2A3CD1'],
    coral: ['#D0482F', '#D2492F'],
    gold: ['#7A5A00', '#FFE14A'],
    rose: ['#B4357A', '#B4357A'],
    mint: ['#0F7A55', '#0F7A55'],
    lilac: ['#7B4FD0', '#7B4FD0'],
  },
  board: {
    chalk: ['#EEF0FA', '#EEF0FA'],
    dim: ['#B4BAD8', '#B4BAD8'],
    faint: ['#5A6396', '#5A6396'],
    task: ['#FFE14A', '#FFE14A'],
    good: ['#5FD3A0', '#5FD3A0'],
    bad: ['#FF7A82', '#FF7A82'],
    board: ['#171C36', '#171C36'],
    sky: ['#8C9BFF', '#8C9BFF'],
    coral: ['#FF9B7A', '#FF9B7A'],
    gold: ['#FFE14A', '#FFE14A'],
    rose: ['#F2A0CF', '#F2A0CF'],
    mint: ['#5FD3A0', '#5FD3A0'],
    lilac: ['#C2B0FF', '#C2B0FF'],
  },
} as const satisfies Record<'sheet' | 'board', Record<string, readonly [text: string, fill: string]>>;

/** Font stacks; `--wq-font-<name>`. Readex Pro carries both scripts; the others have one job each. */
export const FONTS = {
  ui: "'Readex Pro', 'Noto Naskh Arabic', system-ui, -apple-system, 'Segoe UI', sans-serif",
  /** the teacher's red-pen notes only: judge scores, QA findings, teacher comments */
  hand: "'Playpen Sans Arabic', 'Readex Pro', 'Noto Naskh Arabic', system-ui, sans-serif",
  /** money, times, page ranges, step and beat numbers, key caps */
  mono: "'Geist Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
  /** mathematics, always left to right */
  math: "'STIX Two Text', 'Cambria Math', 'Times New Roman', serif",
} as const;

/** Display type: Readex Pro at full width (HEXP 100). Body text keeps HEXP 0, weight 400. */
export const DISPLAY = { variation: "'HEXP' 100", weight: 650 } as const;

/** Type scale (px), line heights and letter spacing. */
export const TYPE = {
  sizes: [12, 14, 16, 20, 24, 32, 44, 64],
  lineHeight: { latin: 1.5, arabic: 1.7, arabicTitle: 1.45 },
  /** Latin display only: Arabic is never letter-spaced */
  displayTracking: '-0.01em',
} as const;

/** Spacing steps (px); `--wq-space-1` … `--wq-space-8`. */
export const SPACE = [4, 8, 12, 16, 24, 32, 48, 64] as const;

/** Corner radii; `--wq-radius-<name>`. */
export const RADIUS = {
  sheet: '6px',
  control: '10px',
  pill: '999px',
  /** the highlighter's hand-drawn shape (with `padding: 0 0.2em`) */
  fluo: '0.3em 0.15em 0.35em 0.2em',
} as const;

/** One lifted-sheet shadow and the dialog shadow; darker on the Board, where navy shadows don't show. */
export const SHADOW = {
  sheet: [
    '0 1px 0 rgba(19,23,46,.04), 0 14px 32px -24px rgba(19,23,46,.35)',
    '0 1px 0 rgba(0,0,0,.25), 0 14px 32px -24px rgba(0,0,0,.8)',
  ],
  dialog: ['0 24px 60px -28px rgba(19,23,46,.55)', '0 24px 60px -28px rgba(0,0,0,.9)'],
} as const satisfies Record<string, Pair>;

/** Motion durations (ms); `--wq-t-<name>`. Leaving takes 70% of arriving (`lift`). */
export const DURATIONS = {
  /** press, hover, a toggle */
  tap: 100,
  /** menus, toasts, cross-fades, language switch */
  menu: 160,
  /** side sheets, dialogs, disclosures, question cards */
  sheet: 240,
  /** the stack of places */
  place: 320,
  /** the tray, the Lift of the preview */
  tray: 400,
  /** player scene moves */
  scene: 600,
} as const;

/**
 * Easing curves; `--wq-ease-<name>` (named apart from the colours: `--wq-ink` is the ink colour). Linear is for
 * progress only.
 */
export const EASINGS = {
  /** arriving: a quick start and a soft landing */
  settle: 'cubic-bezier(.2,.8,.2,1)',
  /** leaving, at 70% of the arrival time */
  lift: 'cubic-bezier(.4,0,1,1)',
  /** the highlighter: pressed down, drawn across, lifted */
  ink: 'cubic-bezier(.6,0,.2,1)',
} as const;

/** Reduced motion: a 120 ms fade only. */
export const REDUCED_MOTION_MS = 120;

/** `theme-color` of pages and installed apps. */
export const THEME_COLOR: Pair = COLORS.ground;

/** Every CSS variable of one scheme, as `[name, value]` pairs (the build writes tokens.css from them). */
export function cssVariables(scheme: 'light' | 'dark'): [string, string][] {
  const i = scheme === 'light' ? 0 : 1;
  const out: [string, string][] = Object.entries(COLORS).map(([k, v]) => [`--wq-${k}`, v[i]]);
  for (const [k, v] of Object.entries(SHADOW)) out.push([`--wq-shadow${k === 'sheet' ? '' : `-${k}`}`, v[i]]);
  if (scheme === 'dark') return out;
  for (const k of BOARD_COLORS) out.push([`--wq-board-${k}`, COLORS[k][1]]);
  for (const [k, v] of Object.entries(FONTS)) out.push([`--wq-font-${k}`, v]);
  SPACE.forEach((v, n) => out.push([`--wq-space-${n + 1}`, `${v}px`]));
  for (const [k, v] of Object.entries(RADIUS)) out.push([`--wq-radius-${k}`, v]);
  for (const [k, v] of Object.entries(DURATIONS)) out.push([`--wq-t-${k}`, `${v}ms`]);
  for (const [k, v] of Object.entries(EASINGS)) out.push([`--wq-ease-${k}`, v]);
  out.push(['--wq-focus', '2px solid var(--wq-ink)']);
  return out;
}

/** tokens.css: the light block, then the dark values for the system setting and for `data-theme="dark"`. */
export function tokensCss(): string {
  const block = (scheme: 'light' | 'dark') =>
    `${cssVariables(scheme)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join('\n')}\n  color-scheme: ${scheme};`;
  const dark = block('dark');
  return [
    '/* Warqa design tokens (generated from packages/brand/src/tokens.ts: edit that file, not this one). */',
    `:root {\n${block('light')}\n}`,
    // CSS can't share one rule between a media query and a selector, so the dark values appear twice here;
    // their one source is tokens.ts
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${dark.replace(/^/gm, '  ')}\n  }\n}`,
    `:root[data-theme="dark"] {\n${dark}\n}`,
    `@media (prefers-reduced-motion: reduce) {\n  :root {\n${Object.keys(DURATIONS)
      // player scenes cut to their next state; everything else fades
      .map((k) => `    --wq-t-${k}: ${k === 'scene' ? 0 : REDUCED_MOTION_MS}ms;`)
      .join('\n')}\n  }\n}`,
    '',
  ].join('\n');
}
