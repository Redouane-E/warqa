// Is a backup the book already in this browser? (redesign 4h). The folder a zip's book came from comes first (a
// copy kept beside the original, "integers-2", keeps the original's id inside), then its id; and it is the same
// book only when a title matches too, so that a different book that happens to share a folder name (every book with
// an Arabic-only title starts as "book") is never offered for replacement.

type Title = Record<string, string> | string;

/** A folder name from a book's id or folder ("Les entiers.warqa" → "les-entiers"). */
export const slugOf = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.warqa$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 40) || 'book';

/** The folders a zip's book may already have here, most likely first: its own folder's name, then its id. */
export function candidates(prefix: string, id: string): string[] {
  const folder = prefix.replace(/\/$/, '').split('/').pop() ?? '';
  return [...new Set([folder && slugOf(folder), id && slugOf(id)].filter(Boolean))];
}

/** The name a new copy takes: the zip's folder, else its id, else the file's name. */
export function newSlug(prefix: string, id: string, hint: string): string {
  return candidates(prefix, id)[0] ?? slugOf(hint);
}

const titles = (t: Title | undefined): string[] =>
  (typeof t === 'string' ? [t] : Object.values(t ?? {}))
    .map((s) => s.normalize('NFC').trim().toLowerCase())
    .filter(Boolean);

/** Two books are the same book when one of their titles (in any language) is the same. */
export function sameTitle(a: Title | undefined, b: Title | undefined): boolean {
  const here = new Set(titles(b));
  return titles(a).some((s) => here.has(s));
}

/** A book id from a folder slug (ids are at most 32 characters and start with a letter). */
export function idOf(slug: string): string {
  const id = slug
    .replace(/^[^a-z]+/, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return id || 'book';
}
