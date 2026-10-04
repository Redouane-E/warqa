// Region layers: simplification, GeoJSON import and the geoBoundaries download (with a fake fetch).
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Project } from '../project/index.js';
import { addGeoLayer, geoNote, listGeoLayers, regionsFromGeoJson, simplifyRing } from './geo.js';

const square = (x: number, y: number, n = 40): [number, number][] => {
  // a square ring with many points on each side (all collinear, so simplification keeps the corners)
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) pts.push([x + i / n, y]);
  for (let i = 0; i < n; i++) pts.push([x + 1, y + i / n]);
  for (let i = 0; i < n; i++) pts.push([x + 1 - i / n, y + 1]);
  for (let i = 0; i < n; i++) pts.push([x, y + 1 - i / n]);
  pts.push([x, y]);
  return pts;
};

const fc = {
  type: 'FeatureCollection',
  features: [
    {
      properties: { shapeName: 'North', shapeISO: 'XX-01' },
      geometry: { type: 'Polygon', coordinates: [square(0, 1)] },
    },
    {
      properties: { shapeName: 'South', shapeISO: 'XX-02' },
      geometry: { type: 'MultiPolygon', coordinates: [[square(0, 0)], [square(3, 0)]] },
    },
    { properties: { other: 'no name' }, geometry: { type: 'Polygon', coordinates: [square(5, 5)] } },
  ],
};

const project = () =>
  Project.create(mkdtempSync(join(tmpdir(), 'warqa-geo-')), { id: 'g', title: 'G', langs: ['ar'], defaultLang: 'ar' });

describe('region layers', () => {
  it('simplifies closed rings without collapsing them', () => {
    const s = simplifyRing(square(0, 0), 0.01);
    expect(s.length).toBeLessThanOrEqual(6);
    expect(s.length).toBeGreaterThanOrEqual(5);
    expect(s[0]).toEqual(s.at(-1));
  });

  it('reads names, codes and every part of a region', () => {
    const r = regionsFromGeoJson(fc);
    expect(r.map((x) => [x.name, x.iso, x.rings.length])).toEqual([
      ['North', 'XX-01', 1],
      ['South', 'XX-02', 2],
    ]);
  });

  it('downloads from geoBoundaries into the book, with licence and credit', async () => {
    const p = project();
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      const body = url.includes('/api/')
        ? {
            simplifiedGeometryGeoJSON: 'https://example.test/x.geojson',
            boundaryLicense: 'Open Data Commons Open Database License 1.0',
            boundarySource: 'OpenStreetMap, Wambacher',
            boundaryYearRepresented: '2017',
          }
        : fc;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const l = await addGeoLayer(p, { country: 'xxx', fetch: fake });
    expect(calls[0]).toBe('https://www.geoboundaries.org/api/current/gbOpen/XXX/ADM1/');
    expect(l.id).toBe('XXX-ADM1');
    expect(l.attribution).toContain('OpenStreetMap');
    expect(l.bbox).toEqual([0, 0, 4, 2]);
    const js = readFileSync(p.path('assets', 'geo', 'XXX-ADM1.js'), 'utf8');
    expect(js).toContain('window.WARQA_GEO_LAYERS["XXX-ADM1"]');
    expect(listGeoLayers(p)[0]?.regions.map((r) => r.iso)).toEqual(['XX-01', 'XX-02']);
    expect(geoNote(p)).toContain('North (XX-01)');
  });

  it('imports a GeoJSON file and refuses bad country codes', async () => {
    const p = project();
    const f = join(p.root, 'my regions.geojson');
    writeFileSync(f, JSON.stringify(fc));
    const l = await addGeoLayer(p, { file: f, attribution: 'Ministry open data' });
    expect(l.id).toBe('my-regions');
    expect(existsSync(p.path('assets', 'geo', 'my-regions.js'))).toBe(true);
    await expect(addGeoLayer(p, { country: 'MA' })).rejects.toThrow(/three-letter/);
  });
});
