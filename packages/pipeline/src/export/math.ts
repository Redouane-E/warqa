// Display math: TeX typeset to self-contained SVG with MathJax 4 (New Computer Modern), at export time, so
// books need no math fonts or scripts and work offline. MathJax is loaded only when a book has "math" nodes.
import { createRequire } from 'node:module';
import { type Lesson, mathSources, UNSAFE_TEX } from '@warqa/lesson';

const require = createRequire(import.meta.url);

interface Typesetter {
  convert(tex: string): string;
}

let typesetter: Typesetter | undefined;

function load(): Typesetter {
  if (typesetter) return typesetter;
  const { mathjax } = require('@mathjax/src/cjs/mathjax.js');
  require('@mathjax/src/cjs/util/asyncLoad/node.js'); // lets the font load its extra glyph files synchronously
  const { TeX } = require('@mathjax/src/cjs/input/tex.js');
  const { SVG } = require('@mathjax/src/cjs/output/svg.js');
  const { liteAdaptor } = require('@mathjax/src/cjs/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('@mathjax/src/cjs/handlers/html.js');
  const packages = ['base', 'ams', 'html', 'color', 'cancel', 'mhchem', 'boldsymbol', 'newcommand'];
  const files: Record<string, string> = {
    base: 'base/BaseConfiguration',
    ams: 'ams/AmsConfiguration',
    html: 'html/HtmlConfiguration',
    color: 'color/ColorConfiguration',
    cancel: 'cancel/CancelConfiguration',
    mhchem: 'mhchem/MhchemConfiguration',
    boldsymbol: 'boldsymbol/BoldsymbolConfiguration',
    newcommand: 'newcommand/NewcommandConfiguration',
  };
  const loaded = packages.filter((p) => {
    try {
      require(`@mathjax/src/cjs/input/tex/${files[p]}.js`);
      return true;
    } catch {
      return false;
    }
  });
  const { MathJaxNewcmFont } = require('@mathjax/mathjax-newcm-font/cjs/svg.js');
  // glyphs for chemistry arrows (\ce{A -> B})
  try {
    MathJaxNewcmFont.addExtension(
      require('@mathjax/mathjax-mhchem-font-extension/cjs/svg.js').MathJaxMhchemFontExtension,
    );
  } catch {
    /* without it, mhchem arrows fall back to plain characters */
  }
  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: loaded }),
    OutputJax: new SVG({ fontCache: 'none', fontData: MathJaxNewcmFont }),
  });
  typesetter = { convert: (tex) => adaptor.outerHTML(doc.convert(tex, { display: true })) };
  return typesetter;
}

export interface TypesetResult {
  svg: string;
  /** TeX error message, if the source does not parse. */
  error?: string;
}

const cache = new Map<string, TypesetResult>();

/** Typeset one TeX source (display style) to an <svg> string. */
export function typeset(tex: string): TypesetResult {
  const hit = cache.get(tex);
  if (hit) return hit;
  let r: TypesetResult;
  if (UNSAFE_TEX.test(tex)) r = { svg: '', error: 'links, raw styles and \\require are not allowed in math' };
  else {
    const out = load().convert(tex);
    const svg = /<svg[\s\S]*<\/svg>/.exec(out)?.[0] ?? '';
    const err = /data-mjx-error="([^"]*)"/.exec(out)?.[1];
    r = { svg: svg.replace(/ style="vertical-align:[^"]*"/, ''), ...(err ? { error: err } : {}) };
  }
  cache.set(tex, r);
  return r;
}

/** TeX sources of every "math" node in a lesson (the keys the player looks up). */
export function lessonMathSources(lesson: Lesson): string[] {
  const out = new Set<string>();
  for (const b of lesson.beats)
    for (const n of b.scene.add)
      if (n.type === 'math')
        for (const s of mathSources(n as unknown as { steps: string[]; mode?: string })) out.add(s);
  return [...out];
}

/** The math table of a lesson: TeX → SVG (only when it has math). */
export function lessonMath(lesson: Lesson): Record<string, string> | undefined {
  const sources = lessonMathSources(lesson);
  if (!sources.length) return undefined;
  return Object.fromEntries(sources.map((s) => [s, typeset(s).svg]).filter(([, svg]) => svg));
}

/** TeX problems in a lesson's math nodes, for validation and the writer's repair loop. */
export function mathProblems(lesson: Lesson): { beat: string; node: string; tex: string; error: string }[] {
  const out: { beat: string; node: string; tex: string; error: string }[] = [];
  for (const b of lesson.beats)
    for (const n of b.scene.add) {
      if (n.type !== 'math') continue;
      for (const s of mathSources(n as unknown as { steps: string[]; mode?: string })) {
        const r = typeset(s);
        if (r.error) out.push({ beat: b.id, node: n.id, tex: s, error: r.error });
      }
    }
  return out;
}
