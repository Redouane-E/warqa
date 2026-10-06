// The teacher's red pen (Kit: "only for notes about a lesson: the judge's score, a check that failed, a teacher's
// comment"): a hand-drawn score mark and a handwritten note. The digits never mirror; each mark leans a little.
import type { ReactNode } from 'react';
import { useI18n } from '../i18n';

// how much each mark leans, beat after beat (degrees; geometry, never mirrored)
const LEAN = [-5, 4, -3, -7, 3, -4, 5, 6, -2, 4, -6, 3, -5, 5, -3];

export function ScoreMark({
  score,
  index = 0,
  size = 'sm',
  weak,
  label,
}: {
  score: number;
  /** Its place (the lean follows it). */
  index?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Under the threshold: drawn heavier. */
  weak?: boolean;
  /** Read out instead of being hidden (where the mark is the only one saying the score). */
  label?: boolean;
}) {
  const { t, num } = useI18n();
  return (
    <span
      className={`pen-score is-${size}${weak ? ' is-weak' : ''}`}
      style={{ rotate: `${LEAN[index % LEAN.length]}deg` }}
      dir="ltr"
      {...(label ? { role: 'img', 'aria-label': t('check.scoreAria', { n: score }) } : { 'aria-hidden': true })}
    >
      {size === 'lg' ? `${num(score)}/${num(5)}` : num(score)}
    </span>
  );
}

/** A note in red pen (the judge's words come in the judge's language: their own direction). */
export function PenNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`pen-note ${className}`} dir="auto">
      {children}
    </p>
  );
}
