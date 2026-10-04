// Third-party component packs. A pack is one plain script that queues a setup function:
//   (globalThis.WARQA_PACKS ||= []).push(function (W) {
//     W.registerComponent({ type: 'clock', pack: 'kids', doc: '…', props: W.z.object({…}), … });
//     if (W.registerView) W.registerView('clock', (ctx) => ({ … }));   // in the player only
//   });
// The same file runs in Node (validation, the writer's catalog) and in the player (drawing).
import * as z from 'zod';
import { COMPONENTS, registerComponent } from './components/registry.js';
import type { ComponentDef } from './core/types.js';
import { ColorName, Id, Size, Text } from './schema/common.js';

export interface PackApi {
  /** Zod, the schema library of the lesson format (use it for props and action args). */
  z: typeof z;
  /** Common prop schemas: localizable text, palette colours, ids, sizes. */
  Text: typeof Text;
  ColorName: typeof ColorName;
  Id: typeof Id;
  Size: typeof Size;
  registerComponent(def: ComponentDef<any>): void;
  /** Player only: register the drawing of a component. */
  registerView?: (type: string, factory: any) => void;
  /** Player only: drawing helpers (h, svg, svgLabel, textWidth, color, COLORS, mix, num, clamp, …). */
  kit?: Record<string, unknown>;
}

export type PackSetup = (api: PackApi) => void;

declare global {
  // eslint-disable-next-line no-var
  var WARQA_PACKS: PackSetup[] | undefined;
}

/** Run queued pack setups (from `queue`, or globalThis.WARQA_PACKS); returns the component types they added. */
export function runPacks(
  extra: Partial<PackApi> = {},
  queue: PackSetup[] | undefined = globalThis.WARQA_PACKS,
): string[] {
  const added: string[] = [];
  const api: PackApi = {
    z,
    Text,
    ColorName,
    Id,
    Size,
    registerComponent(def) {
      if (COMPONENTS[def.type]) return; // already there (built-in names cannot be replaced)
      registerComponent({ ...def, external: true });
      added.push(def.type);
    },
    ...extra,
  };
  for (const setup of queue?.splice(0) ?? []) setup(api);
  return added;
}
