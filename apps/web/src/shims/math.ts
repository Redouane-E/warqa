// Stand-in for @warqa/pipeline's export/math.js in the browser build. The desktop version typesets display math
// ("math" nodes) to SVG with MathJax at export time; MathJax's Node build cannot run here, so in the browser
// math nodes keep their TeX source and the player shows it as text (its fallback when a lesson has no SVG).
// Same exports as the original module.
import { type Lesson, mathSources, UNSAFE_TEX } from '@warqa/lesson';

export interface TypesetResult {
  svg: string;
  /** TeX error message, if the source does not parse. */
  error?: string;
}

const UNSAFE = 'links, raw styles and \\require are not allowed in math';

/** No SVG in the browser; only the safety check of the desktop version. */
export function typeset(tex: string): TypesetResult {
  return UNSAFE_TEX.test(tex) ? { svg: '', error: UNSAFE } : { svg: '' };
}

/** TeX sources of every "math" node in a lesson. */
export function lessonMathSources(lesson: Lesson): string[] {
  const out = new Set<string>();
  for (const b of lesson.beats)
    for (const n of b.scene.add)
      if (n.type === 'math')
        for (const s of mathSources(n as unknown as { steps: string[]; mode?: string })) out.add(s);
  return [...out];
}

/** No math table in the browser: the player falls back to the TeX text. */
export function lessonMath(_lesson: Lesson): Record<string, string> | undefined {
  return undefined;
}

/** Only the safety problems can be found without MathJax. */
export function mathProblems(lesson: Lesson): { beat: string; node: string; tex: string; error: string }[] {
  const out: { beat: string; node: string; tex: string; error: string }[] = [];
  for (const b of lesson.beats)
    for (const n of b.scene.add) {
      if (n.type !== 'math') continue;
      for (const s of mathSources(n as unknown as { steps: string[]; mode?: string }))
        if (UNSAFE_TEX.test(s)) out.push({ beat: b.id, node: n.id, tex: s, error: UNSAFE });
    }
  return out;
}
