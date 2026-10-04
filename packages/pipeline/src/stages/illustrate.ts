// Stage: illustrate — generate pictures for image/storypage nodes that have a `prompt` (children's books,
// explainers). One book-wide style and fixed character descriptions keep illustrations consistent.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { generateImage } from 'ai';
import type { Keys } from '../models/providers.js';
import type { Project } from '../project/index.js';

export interface IllustrationConfig {
  model?: string;
  /** House style added to every picture, e.g. "soft watercolor, warm light, Moroccan town". */
  style?: string;
  /** Recurring characters: name → appearance, added when the prompt mentions the name. */
  characters?: Record<string, string>;
  /** Aspect ratio for generated pictures. */
  aspect?: '16:9' | '4:3' | '1:1';
}

export const DEFAULT_IMAGE_MODELS: [string, string][] = [
  ['OPENAI_API_KEY', 'openai:gpt-image-2'],
  ['GOOGLE_GENERATIVE_AI_API_KEY', 'google:imagen-4.0-generate-001'],
  ['GEMINI_API_KEY', 'google:imagen-4.0-generate-001'],
  ['XAI_API_KEY', 'xai:grok-imagine-image'],
];

function imageModel(ref: string, keys: Keys) {
  const i = ref.indexOf(':');
  const provider = ref.slice(0, i);
  const id = ref.slice(i + 1);
  const need = (k: string[]) => {
    const v = k.map((x) => keys[x]).find(Boolean);
    if (!v) throw new Error(`${provider} images need ${k[0]}`);
    return v;
  };
  if (provider === 'openai') return createOpenAI({ apiKey: need(['OPENAI_API_KEY']) }).image(id);
  if (provider === 'google')
    return createGoogleGenerativeAI({ apiKey: need(['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY']) }).image(id);
  if (provider === 'xai') return createXai({ apiKey: need(['XAI_API_KEY']) }).image(id);
  throw new Error(`no image provider "${provider}" (openai, google, xai)`);
}

export interface IllustrateReport {
  generated: string[];
  kept: string[];
  failed: { node: string; error: string }[];
}

/** Generate missing pictures of a lesson; writes assets/<lesson>/<node>.png and links them in lesson.json. */
export async function illustrateLesson(
  project: Project,
  lessonId: string,
  opts: { config?: IllustrationConfig; keys?: Keys; force?: boolean; onImage?: (node: string) => void } = {},
): Promise<IllustrateReport> {
  const keys = opts.keys ?? process.env;
  const cfg: IllustrationConfig = {
    ...((project.book.pipeline?.illustration as IllustrationConfig | undefined) ?? {}),
    ...(opts.config ?? {}),
  };
  const model = cfg.model ?? DEFAULT_IMAGE_MODELS.find(([k]) => keys[k])?.[1];
  if (!model)
    throw new Error(
      'no image model: set OPENAI_API_KEY, GEMINI_API_KEY or XAI_API_KEY, or pipeline.illustration.model',
    );
  const raw = project.loadLessonRaw(lessonId) as { beats: { scene?: { add?: Record<string, unknown>[] } }[] };
  const report: IllustrateReport = { generated: [], kept: [], failed: [] };
  const dir = project.path('assets', lessonId);
  mkdirSync(dir, { recursive: true });
  for (const beat of raw.beats) {
    for (const node of beat.scene?.add ?? []) {
      const prompt = node.prompt as string | undefined;
      if (!prompt || !['image', 'storypage'].includes(node.type as string)) continue;
      const field = node.type === 'image' ? 'src' : 'image';
      const chars = Object.entries(cfg.characters ?? {}).filter(([name]) =>
        prompt.toLowerCase().includes(name.toLowerCase()),
      );
      const full = [
        cfg.style ? `Style: ${cfg.style}.` : '',
        ...chars.map(([n, d]) => `${n}: ${d}.`),
        `Scene: ${prompt}`,
        'No text, letters or numbers in the picture.',
      ]
        .filter(Boolean)
        .join(' ');
      const hash = createHash('sha1').update(`${model}|${full}`).digest('hex').slice(0, 10);
      const file = `${node.id}-${hash}.png`;
      const rel = `assets/${lessonId}/${file}`;
      if (!opts.force && existsSync(join(dir, file))) {
        node[field] = rel;
        report.kept.push(node.id as string);
        continue;
      }
      try {
        const r = await generateImage({
          model: imageModel(model, keys),
          prompt: full,
          aspectRatio: cfg.aspect ?? '16:9',
          n: 1,
        });
        writeFileSync(join(dir, file), r.image.uint8Array);
        node[field] = rel;
        report.generated.push(node.id as string);
        opts.onImage?.(node.id as string);
        project.saveLesson(lessonId, raw);
      } catch (e) {
        report.failed.push({ node: node.id as string, error: (e as Error).message });
      }
    }
  }
  project.saveLesson(lessonId, raw);
  return report;
}
