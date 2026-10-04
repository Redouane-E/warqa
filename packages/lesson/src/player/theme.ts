// The default "chalk" theme: a chalkboard look adapted from Papermorph (MIT).
export const COLORS: Record<string, string> = {
  chalk: '#ece8dc',
  dim: '#9aaba3',
  faint: '#5d7068',
  task: '#f0b45a',
  good: '#8fd6b0',
  bad: '#f08c7a',
  board: '#1d2b27',
  coral: '#f4a48c',
  sky: '#86c9e8',
  gold: '#f3c95c',
  rose: '#e8a0c8',
  mint: '#8fd6b0',
  lilac: '#bba8ee',
};

export const color = (name: unknown, fallback = COLORS.chalk!): string =>
  (typeof name === 'string' && (COLORS[name] ?? (/^#[0-9a-f]{3,8}$/i.test(name) ? name : undefined))) || fallback;

/** Mix two hex colours (q = share of b). */
export function mix(a: string, b: string, q: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x
    .map((v, i) =>
      Math.round(v + (y[i]! - v) * q)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export const FONT_UI = '"Readex Pro", "Noto Naskh Arabic", "Segoe UI", system-ui, sans-serif';
export const FONT_MATH = '"STIX Two Text", "Cambria Math", "Times New Roman", serif';
export const FONT_READ = '"Noto Naskh Arabic", "Readex Pro", system-ui, serif';

export const TEXT_SIZE = { sm: 26, md: 34, lg: 44, xl: 60 } as const;
export const MATH_SIZE = { sm: 40, md: 52, lg: 66, xl: 84 } as const;

export const STAGE_W = 1600;
export const STAGE_H = 900;
