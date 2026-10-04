// The component catalog a model sees: generated from component definitions, so adding a component teaches
// every model to use it. Also JSON Schemas for constrained decoding.
import * as z from 'zod';
import { COMPONENTS } from '../components/registry.js';
import { GENERIC_ACTIONS } from '../schema/common.js';
import { schemas } from '../schema/lesson.js';
import type { ComponentDef, Pack } from './types.js';

export interface CatalogOptions {
  packs?: Pack[];
  types?: string[];
  /** Include JSON Schemas of props (longer, more exact). */
  schemas?: boolean;
  examples?: boolean;
}

const compact = (schema: z.ZodType) => {
  try {
    const js = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
    delete js.$schema;
    return JSON.stringify(js);
  } catch {
    return '{}';
  }
};

/** Components available for a set of packs / types. */
export function componentsFor(opts: CatalogOptions = {}): ComponentDef<any>[] {
  return Object.values(COMPONENTS).filter(
    (d) => (!opts.packs || opts.packs.includes(d.pack) || !!d.external) && (!opts.types || opts.types.includes(d.type)),
  );
}

/** Markdown catalog of components for prompts. */
export function componentCatalog(opts: CatalogOptions = {}): string {
  const lines: string[] = [];
  lines.push('Generic actions for any node or part ("node" or "node#part"): ' + GENERIC_ACTIONS.join(', ') + '.');
  lines.push(
    'show/hide fade; highlight {color?} draws attention; pulse briefly grows; draw reveals strokes; dim fades to 30 %; color {color} recolours.',
  );
  lines.push('');
  for (const d of componentsFor(opts)) {
    lines.push(`### ${d.type}  (default slot: ${d.defaultSlot})`);
    lines.push(d.doc);
    if (opts.schemas !== false) lines.push(`props: ${compact(d.props)}`);
    for (const [name, a] of Object.entries(d.actions ?? {})) {
      lines.push(`- action ${name}: ${a.doc} args: ${compact(a.args)}`);
    }
    if (opts.examples !== false) {
      for (const ex of d.examples.slice(0, 1)) {
        const node = { id: 'x', type: d.type, ...ex.props };
        lines.push(`example node: ${JSON.stringify(node)}`);
        if (ex.cues?.length) lines.push(`example cues: ${JSON.stringify(ex.cues.map((c) => ({ ...c, at: c.at })))}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** JSON Schema of the full lesson (for providers with schema-constrained decoding). */
export function lessonJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(schemas().Lesson, { unrepresentable: 'any', io: 'input', reused: 'ref' }) as Record<
    string,
    unknown
  >;
}

export function beatJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(schemas().Beat, { unrepresentable: 'any', io: 'input', reused: 'ref' }) as Record<
    string,
    unknown
  >;
}
