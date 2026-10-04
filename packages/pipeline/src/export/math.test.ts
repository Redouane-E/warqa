// MathJax typesetting at export: SVG out, TeX errors reported, unsafe commands refused.
import { mathSources, parseLesson } from '@warqa/lesson';
import { describe, expect, it } from 'vitest';
import { lessonMath, mathProblems, typeset } from './math.js';

describe('display math', () => {
  it('typesets TeX to self-contained SVG', () => {
    const r = typeset('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
    expect(r.error).toBeUndefined();
    expect(r.svg.startsWith('<svg')).toBe(true);
    expect(r.svg).toContain('<path');
    expect(r.svg).not.toContain('vertical-align');
  });

  it('keeps named parts and aligns derivations', () => {
    const [stacked] = mathSources({ mode: 'stack', steps: ['3x + 5 = 20', '\\part{x}{x} = 5'] });
    expect(stacked).toBe('\\begin{aligned}3x + 5 &= 20 \\\\ \\class{wq-p-x}{x} &= 5\\end{aligned}');
    const r = typeset(stacked!);
    expect(r.svg).toContain('wq-p-x');
    expect((r.svg.match(/data-mml-node="mtr"/g) ?? []).length).toBe(2);
  });

  it('reports TeX errors and refuses links', () => {
    expect(typeset('\\frac{1}').error).toBeTruthy();
    expect(typeset('\\href{javascript:alert(1)}{x}').error).toMatch(/not allowed/);
    const lesson = parseLesson({
      schema: 'warqa.lesson/1',
      id: 'm',
      title: 'M',
      lang: 'en',
      beats: [
        {
          id: 'b',
          title: 'B',
          move: 'example',
          narration: 'A fraction.',
          scene: { clear: true, add: [{ id: 'm', type: 'math', steps: ['\\frac{1}{2}', '\\sqrt{'] }] },
          cues: [],
        },
      ],
    });
    expect(Object.keys(lessonMath(lesson) ?? {})).toEqual(['\\frac{1}{2}', '\\sqrt{']);
    expect(mathProblems(lesson).map((p) => p.tex)).toEqual(['\\sqrt{']);
  });
});
