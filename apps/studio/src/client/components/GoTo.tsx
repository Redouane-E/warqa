// Go to (Ctrl/⌘ K): find a book, a step, a chapter, a beat or a setting, or run an action. An action that
// spends shows its cost before Enter. Centred, 20 % from the top; Esc closes it.

import type { IconName } from '@warqa/brand';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JobType } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText, type ProjectListItem } from '../api';
import { useI18n } from '../i18n';
import type { MsgKey } from '../messages';
import { bookTitle } from '../pages/Home';
import { STEPS, usePlace } from '../place';
import { go } from '../router';
import { useJobs } from './JobBoard';
import { useToast } from './overlays';
import { trapTab, useEscape } from './tools';
import { Icon } from './ui';

interface Item {
  id: string;
  group: 'books' | 'book' | 'chapters' | 'beats' | 'actions' | 'settings';
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void | Promise<void>;
}

// search ignores accents and Arabic vowel marks (and the hamza NFKD splits off): "ecole" finds "école", "ابدا" finds "ابدأ"
const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .toLowerCase();

export function GoTo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const i18n = useI18n();
  const { t, lang, usd, num } = i18n;
  const place = usePlace();
  const jobs = useJobs();
  const toast = useToast();
  const { status } = useStatus();
  const [q, setQ] = useState('');
  const [books, setBooks] = useState<ProjectListItem[]>([]);
  const [cost, setCost] = useState<string>('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEscape(open, onClose);

  const book = place.book;
  const bookId = book?.id;
  // on open: an empty field, nothing chosen (Enter alone never starts work), the books and the book's estimate;
  // on close: the focus goes back where it was
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQ('');
    setActive(-1);
    input.current?.focus();
    api
      .projects()
      .then((r) => setBooks(r.projects))
      .catch(() => setBooks([]));
    if (bookId)
      api
        .estimate(bookId)
        .then((e) => setCost(e.error ? '' : `≈ ${usd(e.p50)} – ${usd(e.p90)}`))
        .catch(() => setCost(''));
    return () => {
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body))
        opener.focus({ preventScroll: true });
    };
  }, [open, bookId, usd]);

  const items = useMemo<Item[]>(() => {
    const to = (path: string) => () => {
      onClose();
      void go(path);
    };
    const can = (type: JobType) => !status?.capabilities?.jobsUnavailable.includes(type);
    const out: Item[] = [];
    const run =
      (type: JobType, args: Record<string, unknown> = {}) =>
      async () => {
        if (!book) return;
        onClose();
        try {
          const r = await api.startJob(book.id, type, args);
          jobs.track(book.id, r.job);
        } catch (e) {
          toast({ text: errorText(e, t), tone: 'error' });
        }
      };
    if (book) {
      const base = `/project/${encodeURIComponent(book.id)}`;
      // only work that makes sense now, that this host can run, and never anything that replaces work
      if (book.hasPdf && status?.ingest !== false && can('ingest'))
        out.push({
          id: 'a-read',
          group: 'actions',
          label: t('goto.read'),
          hint: t('goto.readHint'),
          icon: 'add-pdf',
          run: run('ingest', { ocr: 'auto' }),
        });
      if (!book.hasPlan && book.steps.plan !== 'blocked' && can('plan'))
        out.push({
          id: 'a-plan',
          group: 'actions',
          label: t('goto.plan'),
          hint: t('goto.spends'),
          icon: 'edit',
          run: run('plan'),
        });
      if (book.planApproved && can('build'))
        out.push({
          id: 'a-make',
          group: 'actions',
          label: t('goto.make'),
          hint: cost || t('goto.spends'),
          icon: 'play',
          run: run('build'),
        });
      if (book.lessons.length && status?.qa !== false && can('qa'))
        out.push({ id: 'a-check', group: 'actions', label: t('goto.check'), icon: 'preview', run: run('qa') });
      if (book.lessons.length && can('export'))
        out.push({ id: 'a-export', group: 'actions', label: t('goto.export'), icon: 'download', run: run('export') });
      STEPS.forEach((s, i) =>
        out.push({
          id: `s-${s}`,
          group: 'book',
          label: `${num(i + 1)} · ${t(`step.${s}` as MsgKey)}`,
          hint: book.title,
          icon: 'book',
          run: to(`${base}?step=${s}`),
        }),
      );
      out.push({
        id: 'b-settings',
        group: 'settings',
        label: t('common.settings'),
        hint: book.title,
        icon: 'settings',
        run: to(`${base}/settings`),
      });
      out.push({
        id: 'b-review',
        group: 'book',
        label: t('goto.review'),
        hint: book.title,
        icon: 'language',
        run: to(`${base}/review`),
      });
      for (const l of book.lessons)
        out.push({
          id: `c-${l.id}`,
          group: 'chapters',
          label: l.title,
          hint: l.id,
          icon: 'transcript',
          run: to(`${base}/lesson/${encodeURIComponent(l.id)}`),
        });
      if (place.lesson)
        place.lesson.beats.forEach((b, i) =>
          out.push({
            id: `t-${b.id}`,
            group: 'beats',
            label: `${num(i + 1)} · ${b.title}`,
            hint: place.lesson!.title,
            icon: 'cue-thread',
            run: to(`${base}/lesson/${encodeURIComponent(place.lesson!.id)}?beat=${i + 1}`),
          }),
        );
    }
    for (const b of books)
      if (b.id !== book?.id)
        out.push({
          id: `p-${b.id}`,
          group: 'books',
          label: bookTitle(b.title, lang, b.defaultLang),
          icon: 'book',
          run: to(`/project/${encodeURIComponent(b.id)}`),
        });
    out.push({ id: 'g-books', group: 'books', label: t('nav.books'), icon: 'book', run: to('/') });
    out.push({ id: 'g-ai', group: 'settings', label: t('nav.ai'), icon: 'key', run: to('/ai') });
    return out;
  }, [book, place.lesson, books, cost, lang, t, num, jobs, toast, onClose, status]);

  const shown = useMemo(() => {
    const f = fold(q.trim());
    return f ? items.filter((it) => fold(`${it.label} ${it.hint ?? ''}`).includes(f)) : items;
  }, [items, q]);
  // typing chooses the first match (places come before actions); an empty field chooses nothing
  useEffect(() => setActive(q.trim() ? 0 : -1), [q]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keep the active option in view
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;
  const groups: Item['group'][] = ['book', 'chapters', 'beats', 'books', 'settings', 'actions'];
  let n = -1;
  const optionId = (k: number) => `${listId}-${k}`;
  const lists: ReactNode[] = groups.map((g) => {
    const list = shown.filter((it) => it.group === g);
    if (!list.length) return null;
    return (
      // biome-ignore lint/a11y/useSemanticElements: an option group inside the listbox (ARIA), not a form fieldset
      <div key={g} role="group" aria-labelledby={`${listId}-${g}`} className="goto-group">
        <p className="goto-group-title" id={`${listId}-${g}`}>
          {t(`goto.group.${g}` as MsgKey)}
        </p>
        {list.map((it) => {
          n++;
          const k = n;
          return (
            <div
              key={it.id}
              id={optionId(k)}
              role="option"
              aria-selected={k === active}
              className="goto-item"
              // the focus stays in the field (aria-activedescendant); a click or Enter runs the option
              tabIndex={-1}
              onMouseMove={() => setActive(k)}
              onClick={() => void it.run()}
              onKeyDown={(e) => e.key === 'Enter' && void it.run()}
            >
              <Icon name={it.icon} />
              <bdi className="goto-label">{it.label}</bdi>
              {it.hint && <bdi className="goto-hint">{it.hint}</bdi>}
            </div>
          );
        })}
      </div>
    );
  });
  const ordered = groups.flatMap((g) => shown.filter((it) => it.group === g));

  return (
    <>
      <div className="goto-veil" aria-hidden="true" onClick={onClose} />
      <div
        className="goto"
        role="dialog"
        aria-modal="true"
        aria-label={t('goto.title')}
        ref={box}
        onKeyDown={(e) => {
          trapTab(e, box.current);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const m = ordered.length;
            if (m)
              setActive((a) =>
                a < 0 ? (e.key === 'ArrowDown' ? 0 : m - 1) : (a + (e.key === 'ArrowDown' ? 1 : m - 1)) % m,
              );
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void ordered[active]?.run();
          }
        }}
      >
        <div className="goto-field">
          <Icon name="search" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active >= 0 && ordered.length ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label={t('goto.title')}
            placeholder={t('goto.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="goto-list" id={listId} role="listbox" aria-label={t('goto.title')}>
          {ordered.length ? lists : <p className="goto-empty">{t('goto.none')}</p>}
        </div>
      </div>
    </>
  );
}
