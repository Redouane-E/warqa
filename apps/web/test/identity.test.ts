// Which book a backup is: never a different book that shares a folder name (redesign 4h).
import { describe, expect, it } from 'vitest';
import { candidates, idOf, newSlug, sameTitle } from '../src/worker/identity';

describe('a backup and the books here', () => {
  it('looks first at the folder the book came from, then at its id', () => {
    // a copy kept beside the original keeps the original's id inside
    expect(candidates('integers-2.warqa/', 'integers')).toEqual(['integers-2', 'integers']);
    // a long title: the folder is longer than the id
    expect(candidates('les-nombres-relatifs-et-les-fractions.warqa/', 'les-nombres-relatifs-et-les-frac')).toEqual([
      'les-nombres-relatifs-et-les-fractions',
      'les-nombres-relatifs-et-les-frac',
    ]);
    // warqa.json at the top of the zip: the id alone
    expect(candidates('', 'integers')).toEqual(['integers']);
    expect(newSlug('', '', 'My backup')).toBe('my-backup');
  });

  it('is the same book only when a title matches', () => {
    expect(sameTitle({ en: 'Integers, step by step', fr: 'Les entiers' }, { en: 'Integers, step by step' })).toBe(true);
    // any language counts, case and spaces aside
    expect(sameTitle({ ar: 'الأعداد' }, { fr: 'X', ar: ' الأعداد ' })).toBe(true);
    // two Arabic books both in the folder "book": different titles, different books
    expect(sameTitle({ ar: 'الكسور' }, { ar: 'الأعداد' })).toBe(false);
    expect(sameTitle('Integers', undefined)).toBe(false);
  });

  it('gives a copy an id of its own from its folder', () => {
    expect(idOf('integers-2')).toBe('integers-2');
    expect(idOf('les-nombres-relatifs-et-les-fractions-2')).toBe('les-nombres-relatifs-et-les-frac');
    expect(idOf('2024-maths')).toBe('maths');
  });
});
