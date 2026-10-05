// Build the standalone player bundle: dist/bundle/{player.js, player.css, fonts/*}.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist/bundle');
const require = createRequire(import.meta.url);
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: [join(here, 'src/player/boot.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  banner: { js: '/*! Warqa player — Apache-2.0. Portions derived from Papermorph (MIT). */' },
  outfile: join(out, 'player.js'),
  logLevel: 'warning',
});

// Fonts come from @warqa/brand (only the subsets and weights its budget allows), as local files next to the
// player: books work offline and from file://. The folder is emptied first so no older font lingers in exports.
const brand = join(dirname(require.resolve('@warqa/brand/package.json')), 'dist');
rmSync(join(out, 'fonts'), { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });
for (const f of readdirSync(join(brand, 'fonts'))) copyFileSync(join(brand, 'fonts', f), join(out, 'fonts', f));
let css = `${readFileSync(join(brand, 'fonts.css'), 'utf8')}\n`;
// Themes, from the brand tokens: the interface colours (--wq-*) and the stage colours lessons name (--chalk,
// --sky…, with a -fill variant for areas). The Sheet is the default; .wq-theme-board switches to the Board.
const { COLORS, cssVariables, STAGE } = await import('@warqa/brand');
// translucent colours as plain rgba() (color-mix() is too new for the player's oldest browsers)
const rgba = (hex, a) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const mixes = (scheme, theme) => {
  const i = scheme === 'light' ? 0 : 1;
  const stage = (name) => STAGE[theme][name][0];
  return [
    ['--chalk-a4', rgba(stage('chalk'), 0.04)],
    ['--sky-a6', rgba(stage('sky'), 0.06)],
    ['--sky-a8', rgba(stage('sky'), 0.08)],
    ['--bad-a8', rgba(stage('bad'), 0.08)],
    ['--good-a8', rgba(stage('good'), 0.08)],
    ['--board-a92', rgba(STAGE[theme].board[1], 0.92)],
    ['--wq-fluo-a28', rgba(COLORS.fluo[i], 0.28)],
    ['--wq-fluo-a35', rgba(COLORS.fluo[i], 0.35)],
    ['--wq-ground-a80', rgba(COLORS.ground[i], 0.8)],
    ['--wq-seyes-a45', rgba(COLORS.seyes[i], 0.45)],
  ];
};
const block = (scheme, theme) =>
  [
    ...cssVariables(scheme),
    ...mixes(scheme, theme),
    ...Object.entries(STAGE[theme]).flatMap(([name, [text, fill]]) => [
      [`--${name}`, text],
      [`--${name}-fill`, fill],
    ]),
  ]
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
css += `.wq-player,.wq-book{${block('light', 'sheet')};color-scheme:light}\n`;
css += `.wq-player.wq-theme-board,.wq-book.wq-theme-board{${block('dark', 'board')};color-scheme:dark}\n`;
css += readFileSync(join(here, 'src/player/styles.css'), 'utf8');
const min = await esbuild.transform(css, { loader: 'css', minify: true });
writeFileSync(join(out, 'player.css'), min.code);
// Geography for the map component (Natural Earth via world-atlas, public domain), loaded by the player only
// when a lesson has a map: land outlines and country shapes. 1:110m (rounded to 0.1°) for world and continent
// maps in geo-world.js; 1:50m (simplified to ~0.05°, about 5 km) for zoomed-in maps in geo-world-50m.js.
{
  const { feature } = await import('topojson-client');
  // Douglas–Peucker: drop points closer than `tol` degrees to the simplified line
  const simplify = (pts, tol) => {
    if (pts.length < 5 || !tol) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    // a closed ring starts and ends on the same point: split it at the point farthest from the start
    let mid = 0;
    let best = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
      if (d > best) {
        best = d;
        mid = i;
      }
    }
    keep[mid] = 1;
    const stack = [
      [0, mid],
      [mid, pts.length - 1],
    ];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a];
      const [bx, by] = pts[b];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-9;
      let far = -1;
      let dmax = tol;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
        if (d > dmax) {
          dmax = d;
          far = i;
        }
      }
      if (far > 0) {
        keep[far] = 1;
        stack.push([a, far], [far, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };
  for (const [scale, file, global, step, tol] of [
    ['110m', 'geo-world.js', 'WARQA_GEO', 10, 0],
    ['50m', 'geo-world-50m.js', 'WARQA_GEO_50M', 50, 0.05],
  ]) {
    const countries = JSON.parse(readFileSync(require.resolve(`world-atlas/countries-${scale}.json`), 'utf8'));
    const land = JSON.parse(readFileSync(require.resolve(`world-atlas/land-${scale}.json`), 'utf8'));
    const r = (v) => Math.round(v * step) / step;
    const rings = (geom) => {
      if (!geom) return [];
      const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
      return polys.flatMap((poly) =>
        poly.map((ring) => {
          const kept = [];
          for (const [x, y] of ring) {
            const p = [r(x), r(y)];
            const last = kept[kept.length - 1];
            if (!last || last[0] !== p[0] || last[1] !== p[1]) kept.push(p);
          }
          return simplify(kept, tol);
        }),
      );
    };
    const geo = { land: [], countries: {} };
    for (const f of feature(land, land.objects.land).features) geo.land.push(...rings(f.geometry));
    for (const f of feature(countries, countries.objects.countries).features)
      geo.countries[f.properties.name] = rings(f.geometry);
    writeFileSync(
      join(out, file),
      `/* Natural Earth (public domain) via world-atlas (ISC) */window.${global}=${JSON.stringify(geo)};`,
    );
  }
}
console.log('player bundle →', out);
