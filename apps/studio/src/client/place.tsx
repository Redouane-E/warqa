// Where you are: a book (level 2) and maybe a lesson (level 3) on top of Your books (level 1). Pages publish it;
// the top bar (spend), the stack strips and Go to read it.
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { ProjectDetail, StepId, StepState } from '../shared/types';
import { api } from './api';
import { useI18n } from './i18n';
import { bookTitle } from './pages/Home';

export const STEPS: StepId[] = ['read', 'plan', 'make', 'voice', 'check', 'share'];

export interface BookPlace {
  id: string;
  title: string;
  /** Spent on this book, and its limit. */
  spent: number;
  limit?: number;
  /** The step shown (going back to the book lands on it). */
  step: StepId;
  lessons: { id: string; title: string }[];
  hasPdf: boolean;
  /** A plan exists (drafting again would replace it: only the Plan step offers that, behind a dialog). */
  hasPlan: boolean;
  planApproved: boolean;
  steps: Record<StepId, StepState>;
}

export interface LessonPlace {
  id: string;
  title: string;
  beats: { id: string; title: string }[];
}

export interface Place {
  book?: BookPlace;
  lesson?: LessonPlace;
}

const PlaceContext = createContext<{ place: Place; set: (p: Place) => void }>({ place: {}, set: () => {} });

export function PlaceProvider({ children }: { children: ReactNode }) {
  const [place, set] = useState<Place>({});
  const value = useMemo(() => ({ place, set }), [place]);
  return <PlaceContext.Provider value={value}>{children}</PlaceContext.Provider>;
}

export const usePlace = () => useContext(PlaceContext).place;

/** Publish this screen's place while it is shown. */
export function useSetPlace(place: Place | null): void {
  const { set } = useContext(PlaceContext);
  const key = JSON.stringify(place);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialized place is the dependency
  useEffect(() => {
    if (place) set(place);
  }, [key]);
  useEffect(() => () => set({}), [set]);
}

/** A book's place from its detail (the book's screen, or a lesson that loads its book). */
export function bookPlaceOf(p: ProjectDetail, step: StepId, lang: string): BookPlace {
  return {
    id: p.id,
    title: bookTitle(p.title, lang, p.defaultLang),
    spent: p.ledger.total,
    ...(p.config.budget.usd !== undefined ? { limit: p.config.budget.usd } : {}),
    step,
    lessons: p.lessons.map((l) => ({ id: l.id, title: bookTitle(l.title, lang, l.lang) })),
    hasPdf: p.hasPdf,
    hasPlan: !!p.plan,
    planApproved: p.plan?.status === 'approved',
    steps: p.steps,
  };
}

/** A level-3 screen (a lesson, the book's settings, its review) publishes its book, loaded once. */
export function usePublishBook(id: string, step: StepId | 'next', lesson?: LessonPlace): void {
  const { lang } = useI18n();
  const [p, setP] = useState<ProjectDetail | null>(null);
  useEffect(() => {
    let on = true;
    api
      .project(id)
      .then((d) => on && setP(d))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, [id]);
  useSetPlace(
    p
      ? { book: bookPlaceOf(p, step === 'next' ? p.next : step, lang), ...(lesson ? { lesson } : {}) }
      : lesson
        ? { lesson }
        : null,
  );
}
