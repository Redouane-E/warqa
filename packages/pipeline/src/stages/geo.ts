// Region layers for maps: the subdivisions of a country (e.g. Morocco's 12 regions), stored in the book as
//   assets/geo/<id>.js    loaded by the player (sets window.WARQA_GEO_LAYERS[id]; works from file://)
//   assets/geo/<id>.json  the same data plus its source, licence and attribution, for tools and the writer
// Sources: geoBoundaries (current boundaries; licence depends on the country, often ODbL from OpenStreetMap,
// which the map credits on screen) or any GeoJSON file you provide.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Project } from '../project/index.js';

type Ring = [number, number][];

export interface GeoRegion {
  name: string;
  iso?: string;
  rings: Ring[];
}

export interface GeoLayerFile {
  id: string;
  name: string;
  source: string;
  license: string;
  attribution: string;
  bbox: [number, number, number, number];
  regions: GeoRegion[];
}

export interface AddGeoOptions {
  /** ISO 3166-1 alpha-3 country code for geoBoundaries (e.g. MAR, DZA, FRA). */
  country?: string;
  /** Administrative level (1 = regions/states, 2 = provinces/departments). */
  level?: 1 | 2;
  /** A GeoJSON FeatureCollection file instead of downloading. */
  file?: string;
  /** Feature property holding the region name (file import; default: shapeName, name, NAME_1, nom). */
  nameField?: string;
  /** Feature property holding the region code (default: shapeISO, iso_3166_2, iso). */
  isoField?: string;
  /** Layer id (default: <COUNTRY>-ADM<level> or the file name). */
  id?: string;
  /** Credit shown on the map (required for file imports whose licence asks for attribution). */
  attribution?: string;
  license?: string;
  /** Simplification tolerance in degrees (default 0.01 ≈ 1 km). */
  tolerance?: number;
  fetch?: typeof fetch;
}

/** Douglas–Peucker simplification of a closed ring (split at the point farthest from the start). */
export function simplifyRing(pts: Ring, tol: number): Ring {
  if (pts.length < 5 || tol <= 0) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  let mid = 0;
  let best = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i]![0] - pts[0]![0], pts[i]![1] - pts[0]![1]);
    if (d > best) {
      best = d;
      mid = i;
    }
  }
  keep[mid] = 1;
  const stack: [number, number][] = [
    [0, mid],
    [mid, pts.length - 1],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a]!;
    const [bx, by] = pts[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    let far = -1;
    let dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i]![0] - dx * pts[i]![1] + bx * ay - by * ax) / len;
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
}

interface Feature {
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: unknown } | null;
}

const pick = (props: Record<string, unknown>, fields: string[]): string | undefined => {
  for (const f of fields) {
    const v = props[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
};

/** Turn GeoJSON features into simplified region rings (rounded to 0.001°, tiny islands dropped). */
export function regionsFromGeoJson(
  fc: { features?: Feature[] },
  opts: { nameField?: string; isoField?: string; tolerance?: number } = {},
): GeoRegion[] {
  const tol = opts.tolerance ?? 0.01;
  const names = opts.nameField ? [opts.nameField] : ['shapeName', 'name', 'NAME_1', 'NAME_2', 'nom', 'name_en'];
  const isos = opts.isoField ? [opts.isoField] : ['shapeISO', 'iso_3166_2', 'iso', 'ISO', 'code'];
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const out: GeoRegion[] = [];
  for (const f of fc.features ?? []) {
    const props = f.properties ?? {};
    const name = pick(props, names);
    const g = f.geometry;
    if (!name || !g) continue;
    const polys = (
      g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    ) as number[][][][];
    const rings: Ring[] = [];
    for (const poly of polys)
      for (const ring of poly.slice(0, 1)) {
        // outer rings only; holes are rare in admin boundaries and invisible at school-map scale
        const pts = simplifyRing(
          ring.map(([x, y]) => [r3(x!), r3(y!)] as [number, number]),
          tol,
        );
        if (pts.length >= 4) rings.push(pts);
      }
    if (!rings.length) continue;
    const iso = pick(props, isos);
    out.push({ name, ...(iso ? { iso } : {}), rings });
  }
  return out;
}

function bboxOf(regions: GeoRegion[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [180, 90, -180, -90];
  for (const r of regions)
    for (const ring of r.rings)
      for (const [x, y] of ring) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return [x0, y0, x1, y1];
}

/** Short on-map credit for a geoBoundaries source. */
function creditFor(source: string, license: string): string {
  if (/openstreetmap/i.test(source) || /odbl|open database/i.test(license))
    return '© OpenStreetMap contributors (ODbL) · geoBoundaries';
  return `${source || 'geoBoundaries'} · geoBoundaries (${license})`;
}

/** Download (geoBoundaries) or import (GeoJSON file) a region layer into the book. */
export async function addGeoLayer(project: Project, opts: AddGeoOptions): Promise<GeoLayerFile> {
  let fc: { features?: Feature[] };
  let source = 'file';
  let license = opts.license ?? 'see source';
  let attribution = opts.attribution ?? '';
  let name = opts.id ?? '';
  const level = opts.level ?? 1;
  if (opts.file) {
    fc = JSON.parse(readFileSync(opts.file, 'utf8'));
    source = opts.file.split(/[\\/]/).pop()!;
    name ||= source.replace(/\.(geo)?json$/i, '');
  } else {
    const iso3 = (opts.country ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(iso3))
      throw new Error('give a three-letter country code (ISO 3166-1 alpha-3), e.g. MAR for Morocco, DZA, TUN, FRA');
    const f = opts.fetch ?? fetch;
    const meta = await f(`https://www.geoboundaries.org/api/current/gbOpen/${iso3}/ADM${level}/`);
    if (!meta.ok) throw new Error(`geoBoundaries has no ADM${level} boundaries for ${iso3} (HTTP ${meta.status})`);
    const m = (await meta.json()) as Record<string, string>;
    const url = m.simplifiedGeometryGeoJSON ?? m.gjDownloadURL;
    if (!url) throw new Error(`geoBoundaries returned no download link for ${iso3} ADM${level}`);
    const data = await f(url);
    if (!data.ok) throw new Error(`could not download ${url} (HTTP ${data.status})`);
    fc = (await data.json()) as { features?: Feature[] };
    source = `geoBoundaries gbOpen ${iso3} ADM${level} (${m.boundaryYearRepresented ?? 'current'}; ${m.boundarySource ?? 'unknown source'})`;
    license = m.boundaryLicense ?? license;
    attribution ||= creditFor(m.boundarySource ?? '', license);
    name ||= `${iso3}-ADM${level}`;
  }
  const id = name.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 40);
  const regions = regionsFromGeoJson(fc, {
    ...(opts.nameField ? { nameField: opts.nameField } : {}),
    ...(opts.isoField ? { isoField: opts.isoField } : {}),
    ...(opts.tolerance !== undefined ? { tolerance: opts.tolerance } : {}),
  });
  if (!regions.length) throw new Error('no regions found (check the name field of the features)');
  const layer: GeoLayerFile = { id, name, source, license, attribution, bbox: bboxOf(regions), regions };
  mkdirSync(project.path('assets', 'geo'), { recursive: true });
  writeFileSync(project.path('assets', 'geo', `${id}.json`), `${JSON.stringify(layer)}\n`);
  const js = `/* ${source}. Licence: ${license}. Credit: ${attribution || 'see source'} */\nwindow.WARQA_GEO_LAYERS=window.WARQA_GEO_LAYERS||{};window.WARQA_GEO_LAYERS[${JSON.stringify(id)}]=${JSON.stringify({ name, attribution, regions })};\n`;
  writeFileSync(project.path('assets', 'geo', `${id}.js`), js);
  return layer;
}

/** Region layers in the book, with their region names (for the writer and the studio). */
export function listGeoLayers(
  project: Project,
): { id: string; regions: { name: string; iso?: string }[]; attribution: string }[] {
  const dir = project.path('assets', 'geo');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => project.readJson<GeoLayerFile>(`assets/geo/${f}`, { regions: [] } as unknown as GeoLayerFile))
    .filter((l) => l.id)
    .map((l) => ({
      id: l.id,
      regions: l.regions.map((r) => ({ name: r.name, ...(r.iso ? { iso: r.iso } : {}) })),
      attribution: l.attribution,
    }));
}

/** Writer prompt note: which region layers a map can use. */
export function geoNote(project: Project): string {
  const layers = listGeoLayers(project);
  if (!layers.length) return '';
  return `Map region layers in this book (map.regions.layer): ${layers
    .map((l) => `${l.id}: ${l.regions.map((r) => (r.iso ? `${r.name} (${r.iso})` : r.name)).join(', ')}`)
    .join('; ')}`;
}
