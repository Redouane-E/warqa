// The beat inspector (in the side sheet): the beat's title and teaching move, what each mark does, its problems,
// regenerating it, and its JSON as an escape hatch.
import { useEffect, useRef, useState } from 'react';
import type { Issue } from '../../../shared/types';
import { Button, Field, Icon, IssueList, Notice } from '../../components/ui';
import { useI18n } from '../../i18n';
import { moveName } from './BeatList';
import { atText, type Beat, type Cue, markOfCue, marksOf } from './shared';

/* ---------- validated JSON field ---------- */

export function JsonField({
  label,
  value,
  shape,
  onValid,
  resetKey,
}: {
  label: string;
  value: unknown;
  shape: 'object' | 'array';
  onValid: (v: unknown) => void;
  resetKey: string;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(() => JSON.stringify(value ?? (shape === 'array' ? [] : {}), null, 2));
  const [error, setError] = useState('');
  const own = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey re-reads the value when another beat is selected
  useEffect(() => {
    if (own.current) {
      own.current = false;
      return;
    }
    setText(JSON.stringify(value ?? (shape === 'array' ? [] : {}), null, 2));
    setError('');
    // reset when the beat changes or the value changes from outside this field
  }, [resetKey, value, shape]);
  const change = (s: string) => {
    setText(s);
    let v: unknown;
    try {
      v = JSON.parse(s);
    } catch (e) {
      setError(t('editor.jsonError', { error: (e as Error).message }));
      return;
    }
    if (shape === 'array' && !Array.isArray(v)) return setError(t('editor.jsonArray'));
    if (shape === 'object' && (typeof v !== 'object' || v === null || Array.isArray(v)))
      return setError(t('editor.jsonObject'));
    setError('');
    own.current = true;
    onValid(v);
  };
  const rows = Math.min(22, Math.max(4, text.split('\n').length));
  return (
    <Field label={label} error={error}>
      {(id, d) => (
        <textarea
          id={id}
          className="code"
          dir="ltr"
          spellCheck={false}
          rows={rows}
          value={text}
          onChange={(e) => change(e.target.value)}
          aria-describedby={d}
          aria-invalid={!!error}
        />
      )}
    </Field>
  );
}

/* ---------- what each mark does ---------- */

export function CuesByMark({ beat }: { beat: Beat }) {
  const { t } = useI18n();
  const marks = marksOf(beat.narration);
  const cues = beat.cues ?? [];
  const other = cues.filter((c) => {
    const m = markOfCue(c);
    return !m || !marks.includes(m);
  });
  if (!marks.length && !cues.length) return <p className="muted">{t('editor.noMarks')}</p>;
  const cueLine = (c: Cue, i: number) => (
    <li key={i}>
      <code dir="ltr">
        {c.do} <b>{c.target}</b>
        {c.args ? ` ${JSON.stringify(c.args)}` : ''}
      </code>
      {typeof c.at === 'object' && c.at.offset ? (
        <span className="muted small"> {t('editor.at', { at: atText(c.at) })}</span>
      ) : null}
    </li>
  );
  return (
    <ul className="cue-map">
      {marks.map((m) => {
        const mine = cues.filter((c) => markOfCue(c) === m);
        return (
          <li key={m}>
            <span className="mark-chip" dir="ltr">
              {m}
            </span>
            {mine.length ? <ul>{mine.map(cueLine)}</ul> : <span className="warn small">{t('editor.noCues')}</span>}
          </li>
        );
      })}
      {!!other.length && (
        <li>
          <span className="small muted">{t('editor.otherCues')}</span>
          <ul>
            {other.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cues have no id
              <li key={i}>
                <span className="muted small" dir="ltr">
                  {atText(c.at)}
                </span>{' '}
                <code dir="ltr">
                  {c.do} <b>{c.target}</b>
                </code>
              </li>
            ))}
          </ul>
        </li>
      )}
    </ul>
  );
}

/* ---------- regenerate a beat (the rewrite job runs in the tray; the page follows it) ---------- */

export interface RegenState {
  /** A rewrite of this beat is running. */
  busy: boolean;
  error: string;
  /** Unsaved edits: the job rewrites the saved lesson, so they are saved first. */
  disabled: boolean;
  start: (instruction: string) => Promise<void>;
}

export function Regenerate({ regen }: { regen: RegenState }) {
  const { t } = useI18n();
  const [instruction, setInstruction] = useState('');
  return (
    <section className="insp-sec regen" aria-labelledby="regen-title">
      <h3 id="regen-title" className="insp-title">
        {t('editor.regen')}
      </h3>
      <Field label={t('editor.regenInstruction')}>
        {(fid) => (
          <textarea
            id={fid}
            rows={2}
            value={instruction}
            placeholder={t('editor.regenPlaceholder')}
            dir="auto"
            onChange={(e) => setInstruction(e.target.value)}
          />
        )}
      </Field>
      <div className="actions">
        <Button
          icon="regenerate"
          busy={regen.busy}
          disabled={regen.disabled}
          onClick={() => void regen.start(instruction)}
        >
          {t('editor.regenBtn')}
        </Button>
      </div>
      <p className="hint">{regen.disabled ? t('editor.regenSaveFirst') : t('editor.regenHint')}</p>
      {regen.error && <Notice tone="error">{regen.error}</Notice>}
    </section>
  );
}

/* ---------- the inspector ---------- */

export function Inspector({
  beat,
  index,
  lessonLang,
  moves,
  issues,
  update,
  regen,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  beat: Beat;
  index: number;
  lessonLang: string;
  moves: string[];
  issues: Issue[];
  update: (fn: (b: Beat) => void) => void;
  regen: RegenState;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="inspector">
      <section className="insp-sec insp-ident">
        <Field label={t('editor.title')}>
          {(fid) => (
            <input
              id={fid}
              lang={lessonLang}
              dir="auto"
              value={beat.title}
              onChange={(e) => update((b) => void (b.title = e.target.value))}
            />
          )}
        </Field>
        <Field label={t('editor.move')}>
          {(fid) => (
            <select
              id={fid}
              value={beat.move ?? 'example'}
              onChange={(e) => update((b) => void (b.move = e.target.value))}
            >
              {moves.map((m) => (
                <option key={m} value={m}>
                  {moveName(t, m)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </section>

      <section className="insp-sec" aria-labelledby="cues-title">
        <h3 id="cues-title" className="insp-title">
          {t('editor.cuesTitle')}
        </h3>
        <CuesByMark beat={beat} />
      </section>

      <section className="insp-sec" aria-labelledby="issues-title">
        <h3 id="issues-title" className="insp-title">
          {t('editor.issues')}
        </h3>
        {issues.length ? (
          <IssueList issues={issues} />
        ) : (
          <p className="good insp-none">
            <Icon name="check" size={18} /> {t('editor.noIssuesBeat')}
          </p>
        )}
      </section>

      <Regenerate regen={regen} />

      <section className="insp-sec">
        <details className="insp-json">
          <summary>{t('editor.editJson')}</summary>
          <JsonField
            label={t('editor.scene')}
            shape="object"
            value={beat.scene}
            resetKey={`${beat.id}-${index}-scene`}
            onValid={(v) => update((b) => void (b.scene = v as Beat['scene']))}
          />
          <JsonField
            label={t('editor.cues')}
            shape="array"
            value={beat.cues}
            resetKey={`${beat.id}-${index}-cues`}
            onValid={(v) => update((b) => void (b.cues = v as Cue[]))}
          />
          <JsonField
            label={t('editor.questions')}
            shape="array"
            value={beat.questions ?? []}
            resetKey={`${beat.id}-${index}-questions`}
            onValid={(v) =>
              update((b) => {
                if ((v as unknown[]).length) b.questions = v as unknown[];
                else delete b.questions;
              })
            }
          />
        </details>
      </section>

      <section className="insp-sec insp-tools">
        <Button variant="quiet" icon="plus" onClick={onDuplicate}>
          {t('editor.duplicateBeat')}
        </Button>
        {canDelete && (
          <Button variant="quiet" icon="close" className="insp-delete" onClick={onDelete}>
            {t('editor.deleteBeat')}
          </Button>
        )}
      </section>
    </div>
  );
}
