// The section (chapter) map of a book: every PDF page in exactly one section, numbered by PDF page order.
// Portions derived from Papermorph (MIT): scripts/outline.py and scripts/split_pages.py — chapters from the
// bookmark level that marks them, unit title pages folded into the unit's first chapter, "00_front" and
// "99_back", and the no-gaps/no-overlaps check.
import { headingKind, isBackMatterTitle, isTocLine } from './classify.js';
import type { Block, OutlineItem, Section } from './document.js';

const FRONT = { id: '00_front', title: 'Front matter' };
const BACK = { id: '99_back', title: 'Back matter' };
const chapterId = (k: number) => `ch${String(k).padStart(2, '0')}`;

/**
 * Sections from the bookmarks at `level` (the depth whose entries are chapters). The nearest bookmark one level up
 * (a unit or part) becomes the chapter's `unit`, and its title pages go to the start of its first chapter, with
 * `chapterStart` keeping the page where the chapter itself begins. Pages before the first chapter are 00_front;
 * pages from the first later bookmark outside the last chapter (index, appendix…) are 99_back. Chapters that
 * start on the same page are merged. Returns [] when there is no bookmark at that level.
 */
export function sectionsFromOutline(outline: OutlineItem[], pageCount: number, level: number): Section[] {
  const toc = outline.filter((o) => o.page >= 1 && o.page <= pageCount);
  const chapters = toc.map((o, i) => ({ ...o, i })).filter((o) => o.level === level);
  if (!chapters.length || pageCount < 1) return [];
  const last = chapters.at(-1)!;
  // The first bookmark after the last chapter that is not inside it ends the chapters.
  const after = toc.slice(last.i + 1).find((o) => o.level <= level && o.page > last.page)?.page ?? pageCount + 1;

  const parent = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (toc[j]!.level < level) return j;
    return -1;
  };
  type Draft = { title: string; start: number; chapterStart: number; unit?: string };
  const drafts: Draft[] = [];
  let prevUnit = -2;
  for (const ch of chapters) {
    const u = parent(ch.i);
    const unit = u >= 0 ? toc[u] : undefined;
    const firstInUnit = unit !== undefined && u !== prevUnit;
    prevUnit = u;
    const start = firstInUnit && unit.page < ch.page ? unit.page : ch.page;
    drafts.push({ title: ch.title, start, chapterStart: ch.page, ...(unit ? { unit: unit.title } : {}) });
  }
  // Bookmarks out of order or several chapters on one page: keep page order and merge what would be empty.
  drafts.sort((a, b) => a.chapterStart - b.chapterStart);
  const merged: Draft[] = [];
  for (const d of drafts) {
    const prev = merged.at(-1);
    if (prev) {
      if (d.chapterStart <= prev.chapterStart) {
        prev.title = `${prev.title} · ${d.title}`;
        continue;
      }
      // A unit's title pages never reach back into the previous chapter's own first page.
      d.start = Math.max(d.start, prev.chapterStart + 1);
    }
    merged.push(d);
  }
  const sections: Section[] = merged.map((d, k) => ({
    id: chapterId(k + 1),
    title: d.title,
    start: d.start,
    end: (merged[k + 1]?.start ?? Math.min(after, pageCount + 1)) - 1,
    ...(d.unit ? { unit: d.unit } : {}),
    chapterStart: d.chapterStart,
  }));
  const lastSection = sections.at(-1)!;
  if (lastSection.end < lastSection.start) lastSection.end = lastSection.start; // a back-matter bookmark on the chapter's own page
  if (sections[0]!.start > 1) sections.unshift({ ...FRONT, start: 1, end: sections[0]!.start - 1 });
  if (lastSection.end < pageCount) sections.push({ ...BACK, start: lastSection.end + 1, end: pageCount });
  return sections;
}

export interface OutlineLevel {
  level: number;
  count: number;
  /** Entries titled like chapters or lessons ("Chapter 2", "Leçon 3", "الدرس الأول", "4. Fractions"). */
  chapterLike: number;
  /** Entries titled like units or parts ("Unit 1", "Partie II", "الوحدة الثانية"). */
  unitLike: number;
  /** First few titles, for showing the tree to a person. */
  sample: string[];
}

/**
 * Bookmark levels with their counts, and the suggested chapter level:
 * - the shallowest level whose titles are mostly chapter or lesson headings ("Chapitre 3", "الفصل الأول"),
 *   however few (a short PDF with one or two chapters must not be cut at its numbered subsections);
 * - else, among levels with 3–80 entries, the one whose titles look most like chapters, lessons or numbered
 *   sections (ties go to the shallower level); else the shallowest level with 3–80 entries; else any with 2–80.
 */
export function outlineSummary(outline: OutlineItem[]): { levels: OutlineLevel[]; suggested?: number } {
  const by = new Map<number, OutlineLevel>();
  const chapterWords = new Map<number, number>();
  for (const o of outline) {
    const l = by.get(o.level) ?? { level: o.level, count: 0, chapterLike: 0, unitLike: 0, sample: [] };
    l.count++;
    const kind = headingKind(o.title);
    if (kind === 'chapter' || kind === 'numbered') l.chapterLike++;
    if (kind === 'chapter') chapterWords.set(o.level, (chapterWords.get(o.level) ?? 0) + 1);
    if (kind === 'unit') l.unitLike++;
    if (l.sample.length < 5) l.sample.push(o.title);
    by.set(o.level, l);
  }
  const levels = [...by.values()].sort((a, b) => a.level - b.level);
  const named = levels.find((l) => l.count <= 80 && (chapterWords.get(l.level) ?? 0) / l.count >= 0.5);
  if (named) return { levels, suggested: named.level };
  const fit = levels.filter((l) => l.count >= 3 && l.count <= 80);
  const score = (l: OutlineLevel) => (l.chapterLike + 0.5 * l.unitLike) / l.count;
  const best = [...fit].sort((a, b) => score(b) - score(a) || a.level - b.level)[0];
  const suggested =
    best && score(best) >= 0.4
      ? best.level
      : (fit[0]?.level ?? levels.find((l) => l.count >= 2 && l.count <= 80)?.level);
  return suggested === undefined ? { levels } : { levels, suggested };
}

/**
 * Sections without bookmarks, from heading blocks: chapter/lesson headings in English, French or Arabic
 * ("Chapter 3", "Chapitre 2", "Leçon 1", "الفصل الأول", "الدرس ٣"), with unit/part headings as their units;
 * else the pages that carry a top-level heading. Table-of-contents pages and running heads are ignored, and a
 * heading like "Index" or "الفهرس" after the last chapter starts the back matter. Same invariants as
 * sectionsFromOutline; one section covers everything when nothing looks like a chapter.
 */
export function detectSections(blocks: Block[], pageCount: number): Section[] {
  if (pageCount < 1) return [];
  const headings = blocks.filter(
    (b) => b.kind === 'heading' && b.text.trim() && b.page <= pageCount && !isTocLine(b.text),
  );
  // Running heads repeat on many pages; a page listing many chapter titles is a table of contents.
  const seen = new Map<string, Set<number>>();
  for (const h of headings) seen.set(h.text, (seen.get(h.text) ?? new Set()).add(h.page));
  const perPage = new Map<number, number>();
  for (const h of headings) if (headingKind(h.text) === 'chapter') perPage.set(h.page, (perPage.get(h.page) ?? 0) + 1);
  const usable = headings.filter((h) => (seen.get(h.text)?.size ?? 0) <= 2 && (perPage.get(h.page) ?? 0) < 3);

  const firstPerPage = (list: Block[]) => {
    const pages = new Set<number>();
    return list.filter((b) => !pages.has(b.page) && pages.add(b.page));
  };
  const chapters = firstPerPage(usable.filter((h) => headingKind(h.text) === 'chapter'));
  const units = firstPerPage(usable.filter((h) => headingKind(h.text) === 'unit'));
  let outline: OutlineItem[];
  let level = 1;
  if (chapters.length >= 2) {
    outline = [
      ...units.map((b) => ({ level: 1, title: b.text, page: b.page, order: b.page - 0.5 })),
      ...chapters.map((b) => ({ level: 2, title: b.text, page: b.page, order: b.page })),
    ]
      .sort((a, b) => a.order - b.order)
      .map(({ order: _, ...o }) => o);
    level = 2;
  } else if (units.length >= 2) {
    outline = units.map((b) => ({ level: 1, title: b.text, page: b.page }));
  } else {
    const top = Math.min(...usable.map((h) => h.level ?? 6));
    const tops = firstPerPage(usable.filter((h) => (h.level ?? 6) === top));
    outline = tops.length >= 1 && tops.length <= 80 ? tops.map((b) => ({ level: 1, title: b.text, page: b.page })) : [];
  }
  if (outline.length) {
    const lastChapter = Math.max(...outline.filter((o) => o.level === level).map((o) => o.page));
    const back = usable.find((h) => h.page > lastChapter && isBackMatterTitle(h.text));
    if (back) outline.push({ level: 1, title: back.text, page: back.page });
    const sections = sectionsFromOutline(outline, pageCount, level);
    if (sections.length && !validateSections(sections, pageCount).length) return sections;
  }
  const title = headings[0]?.text ?? blocks.find((b) => b.text.trim())?.text.slice(0, 80) ?? 'Document';
  return [{ id: chapterId(1), title, start: 1, end: pageCount, chapterStart: 1 }];
}

/** Problems with a section map: bad or repeated ids, gaps, overlaps, ranges outside the PDF. Empty when valid. */
export function validateSections(sections: Section[], pageCount: number): string[] {
  const errors: string[] = [];
  if (!sections.length) return pageCount > 0 ? ['no sections'] : [];
  const ids = new Set<string>();
  let next = 1;
  for (const s of sections) {
    if (!s.id || /[/\\]/.test(s.id) || s.id === '.' || s.id === '..')
      errors.push(`bad section id: ${JSON.stringify(s.id)}`);
    else if (ids.has(s.id)) errors.push(`repeated section id: ${s.id}`);
    ids.add(s.id);
    if (s.end < s.start) errors.push(`${s.id}: ends (${s.end}) before it starts (${s.start})`);
    if (s.start > next) errors.push(`gap: pages ${next}-${s.start - 1} are in no section (before ${s.id})`);
    else if (s.start < next)
      errors.push(`overlap: ${s.id} starts at ${s.start}, but pages up to ${next - 1} are already taken`);
    if (s.end > pageCount) errors.push(`${s.id}: ends at ${s.end}, the PDF has ${pageCount} pages`);
    if (s.chapterStart !== undefined && (s.chapterStart < s.start || s.chapterStart > s.end))
      errors.push(`${s.id}: chapterStart ${s.chapterStart} is outside ${s.start}-${s.end}`);
    next = Math.max(next, s.end + 1);
  }
  if (next <= pageCount) errors.push(`gap: pages ${next}-${pageCount} are in no section (after the last one)`);
  return errors;
}
