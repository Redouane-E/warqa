// The install manifest of the studio and the web app (exported books write their own, packages/pipeline).
import { THEME_COLOR } from './tokens.js';

/** Icon files the build writes to dist/icons, as a manifest lists them. */
export const MANIFEST_ICONS = [
  { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: 'app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
] as const;

/** A web app manifest; `icons` is the URL of the icons folder relative to the manifest, ending with a slash. */
export function webManifest(opts: {
  name: string;
  shortName: string;
  description: string;
  startUrl: string;
  icons: string;
}) {
  return {
    name: opts.name,
    short_name: opts.shortName,
    description: opts.description,
    start_url: opts.startUrl,
    scope: opts.startUrl,
    display: 'standalone',
    background_color: THEME_COLOR[0],
    theme_color: THEME_COLOR[0],
    icons: MANIFEST_ICONS.map((i) => ({ ...i, src: `${opts.icons}${i.src}` })),
  };
}
