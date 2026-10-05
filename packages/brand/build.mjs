// Build the brand's CSS and assets next to the compiled TypeScript (run after tsc):
//   dist/tokens.css  the CSS variables, light and dark, generated from src/tokens.ts
//   dist/fonts.css   @font-face rules for the bundled fonts, with dist/fonts/*.woff2 and their licences
//   dist/icons/      favicon.svg, mark.svg, app-icon.svg and the PNG app icons (192, 512, maskable, Apple)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import { appIconSvg, drawAppIcon, faviconSvg, markSvg, tokensCss } from './dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
const require = createRequire(import.meta.url);

writeFileSync(join(out, 'tokens.css'), tokensCss());

// Fonts: only the subsets and weights Warqa uses (budget: REDESIGN.md decision 6), as local files so books work
// offline and from file://. Readex Pro is the variable font with its width axis (HEXP), under its usual name.
const FONTS = [
  {
    pkg: '@fontsource-variable/readex-pro',
    family: 'Readex Pro',
    css: ['full.css'],
    subsets: ['arabic', 'latin', 'latin-ext'],
  },
  {
    pkg: '@fontsource/playpen-sans-arabic',
    family: 'Playpen Sans Arabic',
    subsets: ['arabic', 'latin'],
    weights: [400],
  },
  { pkg: '@fontsource/geist-mono', family: 'Geist Mono', subsets: ['latin'], weights: [400] },
  { pkg: '@fontsource/stix-two-text', family: 'STIX Two Text', subsets: ['latin', 'latin-ext'], weights: [400, 600] },
  { pkg: '@fontsource/noto-naskh-arabic', family: 'Noto Naskh Arabic', subsets: ['arabic'], weights: [400, 600] },
];
rmSync(join(out, 'fonts'), { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });
let css = '/* Warqa fonts: SIL Open Font License 1.1 (see fonts/*-OFL.txt) */\n';
for (const font of FONTS) {
  const dir = dirname(require.resolve(`${font.pkg}/package.json`));
  const base = font.pkg.split('/')[1];
  // the per-weight sheets carry every subset with its unicode-range (the per-subset ones have none, so a Latin
  // face would claim Arabic text too and be downloaded first)
  const sheets = font.css ?? font.weights.map((w) => `${w}.css`);
  for (const sheet of sheets) {
    for (const face of readFileSync(join(dir, sheet), 'utf8').match(/@font-face\s*{[^}]*}/g) ?? []) {
      const file = /url\(\.\/files\/([^)]+?)\.woff2\)/.exec(face)?.[1];
      // files are <package>-<subset>-<weight or axes>-normal ("playpen-sans-arabic-arabic-400-normal")
      const subset = file?.slice(base.length + 1).replace(/-[a-z0-9]+-normal$/, '');
      if (!file || !font.subsets.includes(subset)) continue;
      copyFileSync(join(dir, 'files', `${file}.woff2`), join(out, 'fonts', `${file}.woff2`));
      css += `${face
        .replace(/font-family:\s*'[^']+'/, `font-family: '${font.family}'`)
        .replace(/src:[^;]+;/, `src: url(fonts/${file}.woff2) format('woff2');`)}\n`;
    }
  }
  copyFileSync(join(dir, 'LICENSE'), join(out, 'fonts', `${base}-OFL.txt`));
}
writeFileSync(join(out, 'fonts.css'), css);

// Icons
mkdirSync(join(out, 'icons'), { recursive: true });
writeFileSync(join(out, 'icons', 'favicon.svg'), faviconSvg());
writeFileSync(join(out, 'icons', 'mark.svg'), markSvg({ variant: 'ink', title: 'Warqa' }));
writeFileSync(join(out, 'icons', 'app-icon.svg'), appIconSvg(512));
for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  const c = createCanvas(size, size);
  drawAppIcon(c.getContext('2d'), size, (d) => new Path2D(d), { maskable });
  writeFileSync(join(out, 'icons', name), c.toBuffer('image/png'));
}
