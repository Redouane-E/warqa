// A small, safe math expression parser (no eval): numbers, variables, + − * / ^, unary minus, parentheses,
// implicit multiplication (2x, 3(x+1)), functions and constants. Used for plotting and checking answers.
import { normalizeDigits } from '@warqa/i18n';

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'un'; op: '-'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'fn'; name: string; a: Node };

const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};
const CONSTS: Record<string, number> = { pi: Math.PI, π: Math.PI, e: Math.E };

function tokenize(src: string): string[] {
  const s = normalizeDigits(src)
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt');
  const out: string[] = [];
  const re = /\s*(\d+(?:\.\d*)?|\.\d+|[A-Za-zπ]+|[-+*/^(),])/y;
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i]!)) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new SyntaxError(`unexpected "${s[i]}" in "${src}"`);
    out.push(m[1]!);
    i = re.lastIndex;
  }
  return out;
}

function parse(src: string, vars: string[]): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: string) => {
    if (next() !== t) throw new SyntaxError(`expected "${t}" in "${src}"`);
  };
  const startsAtom = (t: string | undefined) =>
    t !== undefined && (/^[\d.]/.test(t) || /^[A-Za-zπ]/.test(t) || t === '(');

  function expr(): Node {
    let a = term();
    while (peek() === '+' || peek() === '-') {
      const op = next() as '+' | '-';
      a = { k: 'bin', op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = unary();
    for (;;) {
      if (peek() === '*' || peek() === '/') {
        const op = next() as '*' | '/';
        a = { k: 'bin', op, a, b: unary() };
      } else if (startsAtom(peek()))
        a = { k: 'bin', op: '*', a, b: power() }; // implicit: 2x, 3(x+1)
      else return a;
    }
  }
  function unary(): Node {
    if (peek() === '-') {
      next();
      return { k: 'un', op: '-', a: unary() };
    }
    if (peek() === '+') {
      next();
      return unary();
    }
    return power();
  }
  function power(): Node {
    const a = atom();
    if (peek() === '^') {
      next();
      return { k: 'bin', op: '^', a, b: unary() }; // right-associative, allows 2^-1
    }
    return a;
  }
  function atom(): Node {
    const t = next();
    if (t === undefined) throw new SyntaxError(`unexpected end of "${src}"`);
    if (t === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    if (/^[\d.]/.test(t)) return { k: 'num', v: Number(t) };
    if (/^[A-Za-zπ]+$/.test(t)) {
      const lower = t.toLowerCase();
      if (FUNCS[lower]) {
        if (peek() === '(') {
          next();
          const e = expr();
          expect(')');
          return { k: 'fn', name: lower, a: e };
        }
        return { k: 'fn', name: lower, a: power() };
      }
      if (vars.includes(t)) return { k: 'var', name: t };
      if (t in CONSTS) return { k: 'num', v: CONSTS[t]! };
      // "xy" or "2xy": split into single-letter variables
      if ([...t].every((c) => vars.includes(c))) {
        return [...t].map<Node>((c) => ({ k: 'var', name: c })).reduce((a, b) => ({ k: 'bin', op: '*', a, b }));
      }
      throw new SyntaxError(`unknown name "${t}" in "${src}"`);
    }
    throw new SyntaxError(`unexpected "${t}" in "${src}"`);
  }

  const tree = expr();
  if (p < toks.length) throw new SyntaxError(`unexpected "${toks[p]}" in "${src}"`);
  return tree;
}

function evaluate(n: Node, env: Record<string, number>): number {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'var':
      return env[n.name] ?? Number.NaN;
    case 'un':
      return -evaluate(n.a, env);
    case 'fn':
      return FUNCS[n.name]!(evaluate(n.a, env));
    case 'bin': {
      const a = evaluate(n.a, env);
      const b = evaluate(n.b, env);
      switch (n.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
        case '^':
          return a ** b;
      }
    }
  }
}

/** Compile an expression to a function of the given variables. Throws SyntaxError on bad input. */
export function compileExpr(src: string, vars: string[] = ['x']): (env: Record<string, number>) => number {
  const tree = parse(src, vars);
  return (env) => evaluate(tree, env);
}

/** Evaluate a closed expression ("4 + (−9)", "2^3 - 1"). */
export const evalExpr = (src: string): number => compileExpr(src, [])({});

/** Numerically check that two expressions agree on sample points (for "equivalent expression" answers). */
export function sameFunction(
  a: string,
  b: string,
  vars: string[] = ['x'],
  samples = [-2.3, -1, 0, 0.7, 1.9, 3.1],
): boolean {
  const fa = compileExpr(a, vars);
  const fb = compileExpr(b, vars);
  return samples.every((s) => {
    const env = Object.fromEntries(vars.map((v, j) => [v, s + j * 0.37]));
    const x = fa(env);
    const y = fb(env);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return Number.isNaN(x) === Number.isNaN(y);
    return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  });
}
