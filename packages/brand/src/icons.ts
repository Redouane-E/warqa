// Icons: a 24 grid, a 1.75 stroke, round caps and joins, `currentColor`. The set is the Kit artboard's; each
// icon is one stroked path (circles and rectangles written as paths) and, for a few, a filled part, so React
// and plain SVG strings draw them the same way.

/** A stroked path, and an optional part filled with the stroke colour. */
export interface IconDef {
  d: string;
  fill?: string;
}

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
const tray = 'M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3';

export const ICONS = {
  // the player (Kit)
  play: { d: 'M8 5.5v13l10.5-6.5z', fill: 'M8 5.5v13l10.5-6.5z' },
  pause: { d: 'M9 5v14M15 5v14' },
  back: { d: 'M15 6l-6 6 6 6' },
  next: { d: 'M9 6l6 6-6 6' },
  restart: { d: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4' },
  captions: { d: `${rect(3, 5, 18, 14, 2)}M7 15h4M13 15h4M7 11h10` },
  transcript: { d: 'M5 4h11l3 3v13H5zM8 10h8M8 14h8M8 18h5' },
  speed: { d: 'M5 17a8 8 0 1 1 14 0M12 13l4-4' },
  language: {
    d: `${circle(12, 12, 9)}M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z`,
  },
  fullscreen: { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' },
  voice: { d: 'M4 10v4h4l5 4V6L8 10zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' },
  // the studio (Kit)
  'add-pdf': { d: `M12 16V4M7 9l5-5 5 5${tray}` },
  download: { d: `M12 4v12M7 11l5 5 5-5${tray}` },
  key: { d: `${circle(8, 15, 4)}M11 12l9-9M17 6l3 3M15 8l2 2` },
  regenerate: { d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4' },
  edit: { d: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3' },
  locked: { d: `${rect(5, 11, 14, 9, 2)}M8 11V8a4 4 0 0 1 8 0v3` },
  'cue-thread': {
    d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  },
  book: { d: 'M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5zM12 6v13.5' },
  settings: { d: `M4 7h10M18 7h2M4 17h4M12 17h8${circle(16, 7, 2)}${circle(10, 17, 2)}` },
  search: { d: `${circle(11, 11, 6.5)}M16 16l4.5 4.5` },
  stop: { d: rect(6, 6, 12, 12, 2) },
  open: { d: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' },
  'board-theme': { d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' },
  // states and notices (Kit)
  check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  close: { d: 'M6 6l12 12M18 6L6 18' },
  info: { d: `${circle(12, 12, 9)}M12 11v5.5M12 7.8v.01` },
  error: { d: `${circle(12, 12, 9)}M12 7.5v5.5M12 16.5v.01` },
  warn: { d: 'M12 3.5L2.5 20h19zM12 10v4.5M12 17.5v.01' },
  // no network: the wifi waves crossed out (the States board)
  offline: {
    d: 'M2 8.5a15 15 0 0 1 5-3M22 8.5a15 15 0 0 0-8.5-3.8M5.5 12a10 10 0 0 1 3-1.8M18.5 12a10 10 0 0 0-2.4-1.6M9 15.5a5 5 0 0 1 6 0M12 19.5v.01M3 3l18 18',
  },
  preview: { d: `M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z${circle(12, 12, 3)}` },
  more: { d: `${circle(5, 12, 1.6)}${circle(12, 12, 1.6)}${circle(19, 12, 1.6)}` },
  // missing from the Kit, drawn in its style
  plus: { d: 'M12 5v14M5 12h14' },
  up: { d: 'M12 19V5M6 11l6-6 6 6' },
  down: { d: 'M12 5v14M6 13l6 6 6-6' },
  file: { d: 'M6 3.5h8l4 4v13H6zM14 3.5v4h4' },
  'sheet-theme': {
    d: `${circle(12, 12, 4)}M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4`,
  },
  'auto-theme': { d: circle(12, 12, 9), fill: 'M12 3a9 9 0 0 1 0 18z' },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

/** Icons that point along the reading order: they swap in right-to-left pages (play never does). */
export const MIRRORED: ReadonlySet<IconName> = new Set<IconName>(['back', 'next']);

export const ICON_STROKE = 1.75;

export const isIconName = (name: string): name is IconName => Object.hasOwn(ICONS, name);

/** An icon as an SVG string (decorative), for code that doesn't use React (the player, exports). */
export function iconSvg(name: IconName, size = 24, className = 'wq-icon'): string {
  const def: IconDef = ICONS[name];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${className}${MIRRORED.has(name) ? ` ${className}-mirror` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
    `<path d="${def.d}"/>${def.fill ? `<path d="${def.fill}" fill="currentColor" stroke="none"/>` : ''}</svg>`
  );
}
