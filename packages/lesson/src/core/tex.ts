// A small TeX-like reader for equation steps: "x^2 + 2x + 1", "\frac{3}{4} = 0.75", "a_n = 2n", "\sqrt{9} = 3".
// It turns a string into the equation's tokens (terms and operators), so models can write math naturally
// while every token stays animatable.

export interface TexToken {
  t?: string;
  frac?: [string, string];
  sup?: string;
  sub?: string;
}

const SYMBOLS: Record<string, string> = {
  times: '×',
  div: '÷',
  cdot: '·',
  pm: '±',
  mp: '∓',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  infty: '∞',
  pi: 'π',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  Delta: 'Δ',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  sigma: 'σ',
  Sigma: 'Σ',
  omega: 'ω',
  Omega: 'Ω',
  degree: '°',
  circ: '°',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  cup: '∪',
  cap: '∩',
  emptyset: '∅',
  to: '→',
  rightarrow: '→',
  Rightarrow: '⇒',
  Leftrightarrow: '⇔',
  left: '',
  right: '',
  quad: ' ',
  ',': ' ',
};

const OPERATORS = new Set(['+', '−', '-', '=', '×', '÷', '·', '±', '<', '>', '≤', '≥', '≠', '≈', '→', '⇒', '⇔', '∈']);

/** Read a {group} starting at i (or a single character). */
function group(s: string, i: number): [string, number] {
  while (s[i] === ' ') i++;
  if (s[i] === '{') {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
    }
    return [s.slice(i + 1), s.length];
  }
  if (s[i] === '\\') {
    const m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
    if (m) return [SYMBOLS[m[1]!] ?? m[1]!, i + m[0].length];
  }
  return [s[i] ?? '', i + 1];
}

/** Flatten simple TeX inside a group to plain text (for exponents, indices and fraction parts). */
export function texText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const c = s[i]!;
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i))!;
      const name = m[1]!;
      i += m[0].length;
      if (name === 'frac') {
        const [a, j] = group(s, i);
        const [b, k] = group(s, j);
        out += `${texText(a)}/${texText(b)}`;
        i = k;
      } else if (name === 'sqrt') {
        const [a, j] = group(s, i);
        out += `√${texText(a).length > 1 ? `(${texText(a)})` : texText(a)}`;
        i = j;
      } else out += SYMBOLS[name] ?? (name.length === 1 ? name : '');
    } else if (c === '{' || c === '}') i++;
    else if (c === '-') {
      out += '−';
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * Tokenize a TeX-like expression into equation tokens: operators become their own tokens (with spaces),
 * \frac becomes a built-up fraction, ^ and _ attach to the preceding term.
 */
export function texToTokens(src: string): (string | TexToken)[] {
  const out: (string | TexToken)[] = [];
  let term = '';
  const flush = () => {
    if (term.trim()) out.push(term.trim());
    term = '';
  };
  const attach = (kind: 'sup' | 'sub', value: string) => {
    if (term.trim()) {
      out.push({ t: term.trim(), [kind]: value });
      term = '';
      return;
    }
    const prev = out[out.length - 1];
    if (prev && typeof prev === 'object' && !prev.frac && !prev[kind]) prev[kind] = value;
    else if (typeof prev === 'string' && !OPERATORS.has(prev.trim())) out[out.length - 1] = { t: prev, [kind]: value };
    else out.push({ t: '', [kind]: value });
  };
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i))!;
      const name = m[1]!;
      i += m[0].length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        flush();
        const [a, j] = group(src, i);
        const [b, k] = group(src, j);
        out.push({ frac: [texText(a), texText(b)] });
        i = k;
      } else if (name === 'sqrt') {
        const [a, j] = group(src, i);
        term += `√${texText(a).length > 1 ? `(${texText(a)})` : texText(a)}`;
        i = j;
      } else {
        const sym = SYMBOLS[name] ?? name;
        if (OPERATORS.has(sym)) {
          flush();
          out.push(` ${sym} `);
        } else term += sym;
      }
    } else if (c === '^' || c === '_') {
      const [g, j] = group(src, i + 1);
      attach(c === '^' ? 'sup' : 'sub', texText(g));
      i = j;
    } else if ('+-=<>'.includes(c) || c === '−' || OPERATORS.has(c)) {
      // a leading minus (or one right after an operator or "(") is a sign, not an operator
      const prev = out[out.length - 1];
      const isSign =
        (c === '-' || c === '−') &&
        !term.trim() &&
        (out.length === 0 || (typeof prev === 'string' && OPERATORS.has(prev.trim())));
      if (isSign || ((c === '-' || c === '−') && /\($/.test(term))) {
        term += '−';
      } else {
        flush();
        const op = c === '-' ? '−' : c === '<' && src[i + 1] === '=' ? '≤' : c === '>' && src[i + 1] === '=' ? '≥' : c;
        if ((c === '<' || c === '>') && src[i + 1] === '=') i++;
        out.push(` ${op} `);
      }
      i++;
    } else if (c === '{' || c === '}') i++;
    else if (c === '*') {
      flush();
      out.push(' × ');
      i++;
    } else if (c === ' ') {
      term += term && !term.endsWith(' ') ? ' ' : '';
      i++;
    } else {
      term += c;
      i++;
    }
  }
  flush();
  return out;
}

// --- display math (the "math" component, typeset with MathJax at export) ---------------------------------

/** Names of the parts marked with \part{name}{…} in a TeX string. */
export const texParts = (tex: string): string[] => [...tex.matchAll(/\\part\{([\w-]+)\}/g)].map((m) => m[1]!);

/** TeX as MathJax receives it: \part{name}{…} becomes \class{wq-p-name}{…}. */
export const prepareTex = (tex: string): string => tex.replace(/\\part\{([\w-]+)\}/g, '\\class{wq-p-$1}');

/** A derivation: lines stacked and aligned on their first "=" (or where the author put "&"). */
export function stackTex(lines: string[]): string {
  const rows = lines.map((l) => {
    const t = prepareTex(l);
    if (t.includes('&')) return t;
    const i = t.search(/(?<![<>!\\])=/);
    return i < 0 ? `&${t}` : `${t.slice(0, i)}&${t.slice(i)}`;
  });
  return `\\begin{aligned}${rows.join(' \\\\ ')}\\end{aligned}`;
}

/** Every TeX source a math node needs typeset (the keys of the export's math table). */
export function mathSources(props: { steps: string[]; mode?: string }): string[] {
  return props.mode === 'stack' ? [stackTex(props.steps)] : props.steps.map(prepareTex);
}

/** TeX commands that must not reach the typesetter (links, raw styles). */
export const UNSAFE_TEX = /\\(?:href|url|style|cssId|data|unicode|require)\b/;
