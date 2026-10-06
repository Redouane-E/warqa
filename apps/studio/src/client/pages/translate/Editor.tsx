// The texts of the review queue: the original, read only, with its marks and formulas drawn as locked chips; and the
// translation, a plain text box (typing, pasting, an Arabic keyboard and a screen reader behave as usual) over a copy
// of its text that draws the same tokens locked, the words still saying what the original said before, the glossary
// term, and where a lost mark goes back. The copy changes colours only, never widths, so the letters stay in line.
import { dirOf } from '@warqa/i18n';
import { forwardRef, type ReactNode, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Icon } from '../../components/ui';
import { useI18n } from '../../i18n';
import { type Ranges, type Tok, tokensOf } from './tokens';

/** A text run split where ranges begin and end, each piece knowing which ranges cover it. */
function pieces(t: Tok, layers: { cls: string; ranges: Ranges }[]): { text: string; cls: string }[] {
  const cuts = new Set([t.start, t.end]);
  for (const l of layers)
    for (const [a, b] of l.ranges) {
      if (a > t.start && a < t.end) cuts.add(a);
      if (b > t.start && b < t.end) cuts.add(b);
    }
  const at = [...cuts].sort((x, y) => x - y);
  const out: { text: string; cls: string }[] = [];
  for (let k = 0; k + 1 < at.length; k++) {
    const [a, b] = [at[k]!, at[k + 1]!];
    const cls = layers
      .filter((l) => l.ranges.some(([x, y]) => x <= a && y >= b))
      .map((l) => l.cls)
      .join(' ');
    out.push({ text: t.text.slice(a - t.start, b - t.start), cls });
  }
  return out;
}

/** The original, read only: tokens as chips (a lost mark in red pen), changed words wavy-underlined. */
export function SourceText({
  text,
  kind,
  lang,
  lost = [],
  changed = [],
  terms = [],
}: {
  text: string;
  kind: string;
  lang: string;
  lost?: string[];
  changed?: Ranges;
  terms?: Ranges;
}) {
  const { t } = useI18n();
  return (
    <p className="rv-source" lang={lang} dir={dirOf(lang)}>
      {tokensOf(text, kind).map((tok) => {
        if (tok.kind === 'text')
          return pieces(tok, [
            { cls: 'tx-changed', ranges: changed },
            { cls: 'tx-term', ranges: terms },
          ]).map((pc) =>
            pc.cls ? (
              <span key={`${tok.start}-${pc.text}-${pc.cls}`} className={pc.cls}>
                {pc.text}
              </span>
            ) : (
              pc.text
            ),
          );
        if (tok.kind === 'math')
          return (
            <span key={tok.start} className="tok tok-math" dir="ltr" title={t('review.tokMath')}>
              <Icon name="locked" size={13} />
              <span className="tok-tex">{tok.tex}</span>
            </span>
          );
        return (
          <span
            key={tok.start}
            className={`tok tok-mark${lost.includes(tok.name) ? ' is-lost' : ''}`}
            dir="ltr"
            title={t(tok.kind === 'box' ? 'review.tokBox' : 'review.tokMark', { name: tok.name })}
          >
            <Icon name="locked" size={11} />
            {tok.name}
          </span>
        );
      })}
    </p>
  );
}

export interface TranslationBoxHandle {
  focus: (caret?: number) => void;
  caret: () => number | undefined;
}

/** The translation's text box over its drawn copy. */
export const TranslationBox = forwardRef<
  TranslationBoxHandle,
  {
    value: string;
    kind: string;
    lang: string;
    label: string;
    describedBy?: string;
    /** Where a lost mark belongs (a red caret is drawn there). */
    hole?: number | undefined;
    stale?: Ranges;
    terms?: Ranges;
    invalid?: boolean;
    onChange: (s: string) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  }
>(function TranslationBox(
  { value, kind, lang, label, describedBy, hole, stale = [], terms = [], invalid, onChange, onKeyDown },
  ref,
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: (caret) => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      if (caret !== undefined) el.setSelectionRange(caret, caret);
    },
    caret: () => (ta.current && document.activeElement === ta.current ? ta.current.selectionStart : undefined),
  }));
  // the box grows with its text (no scrollbar: the copy under it stays in line)
  // biome-ignore lint/correctness/useExhaustiveDependencies: again when the text changes
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.blockSize = 'auto';
    el.style.blockSize = `${el.scrollHeight + 2}px`;
  }, [value]);
  const dir = dirOf(lang);
  const drawn: ReactNode[] = [];
  for (const tok of tokensOf(value, kind)) {
    if (hole !== undefined && hole === tok.start) drawn.push(<span key="hole" className="rv-hole" />);
    if (tok.kind === 'text') {
      const ps = pieces(tok, [
        { cls: 'tx-changed', ranges: stale },
        { cls: 'tx-term', ranges: terms },
      ]);
      let at = tok.start;
      for (const pc of ps) {
        if (hole !== undefined && hole > at && hole < at + pc.text.length) {
          const cut = hole - at;
          drawn.push(
            <span key={`${at}a`} className={pc.cls || undefined}>
              {pc.text.slice(0, cut)}
            </span>,
            <span key="hole" className="rv-hole" />,
            <span key={`${at}b`} className={pc.cls || undefined}>
              {pc.text.slice(cut)}
            </span>,
          );
        } else
          drawn.push(
            <span key={at} className={pc.cls || undefined}>
              {pc.text}
            </span>,
          );
        at += pc.text.length;
      }
    } else if (tok.kind === 'math')
      drawn.push(
        <span key={tok.start} className="tok-raw tok-raw-math">
          {tok.text}
        </span>,
      );
    else
      drawn.push(
        // the brackets are hidden under a lock; the name stays as typed
        <span key={tok.start} className="tok-raw tok-raw-mark">
          <span className="tok-br">[[</span>
          {tok.name}
          <span className="tok-br">]]</span>
        </span>,
      );
  }
  if (hole !== undefined && hole >= value.length) drawn.push(<span key="hole" className="rv-hole" />);
  return (
    <div className={`rv-box${invalid ? ' is-invalid' : ''}`} lang={lang} dir={dir}>
      <div className="rv-back" aria-hidden="true">
        {drawn}
        {value.endsWith('\n') ? ' ' : ''}
      </div>
      <textarea
        ref={ta}
        className="rv-input"
        rows={1}
        value={value}
        spellCheck
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
});
