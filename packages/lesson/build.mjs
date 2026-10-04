// Build the standalone player bundle: dist/bundle/{player.js, player.css, fonts/*}.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist/bundle');
const require = createRequire(import.meta.url);
mkdirSync(join(out, 'fonts'), { recursive: true });

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

// Fonts: only the subsets and weights the player uses, rewritten to local files (works offline and from file://).
const FONTS = [
  ['readex-pro', ['arabic', 'latin', 'latin-ext'], [400, 500, 600, 700]],
  ['stix-two-text', ['latin', 'latin-ext'], [400, 600]],
  ['noto-naskh-arabic', ['arabic'], [400, 600]],
];
let css = '/* Fonts: SIL Open Font License 1.1 (see fonts/OFL.txt) */\n';
for (const [name, subsets, weights] of FONTS) {
  const pkg = dirname(require.resolve(`@fontsource/${name}/package.json`));
  for (const subset of subsets) {
    for (const w of weights) {
      let block;
      try {
        block = readFileSync(join(pkg, `${subset}-${w}.css`), 'utf8');
      } catch {
        continue;
      }
      block = block.replace(
        /url\(\.\/files\/([^)]+?)\.woff2\) format\('woff2'\),\s*url\([^)]+\.woff\) format\('woff'\)/g,
        (_, f) => {
          copyFileSync(join(pkg, 'files', `${f}.woff2`), join(out, 'fonts', `${f}.woff2`));
          return `url(fonts/${f}.woff2) format('woff2')`;
        },
      );
      css += block.replace(/\/\*[\s\S]*?\*\//g, '').trim() + '\n';
    }
  }
  try {
    copyFileSync(join(pkg, 'LICENSE'), join(out, 'fonts', `${name}-OFL.txt`));
  } catch {}
}
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
