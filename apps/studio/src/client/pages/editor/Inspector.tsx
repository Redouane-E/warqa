// The beat inspector (in the side sheet), generated from the lesson format: the beat's title and teaching move,
// the parts on its stage (forms from their components' definitions), what each mark does (the cue editor), its
// questions, its problems, regenerating it, and its whole JSON as an escape hatch.
import { dirOf } from '@warqa/i18n';
import { useEffect, useRef, useState } from 'react';
import type { EditorCatalog, Issue, ProjectDetail, StagePart } from '../../../shared/types';
import { useNetGate } from '../../components/states';
import { Button, Field, Icon, IssueList, Notice } from '../../components/ui';
import { useI18n } from '../../i18n';
import { moveName } from './BeatList';
import { CuesSection } from './Cues';
import { StageSection } from './Parts';
import { QuestionsSection } from './Questions';
import { type Beat, beatProblem, type KeyMove } from './shared';

/* ---------- validated JSON field ---------- */

export function JsonField({
  label,
  value,
  shape,
  onValid,
  resetKey,
  check,
}: {
  label: string;
  value: unknown;
  shape: 'object' | 'array';
  onValid: (v: unknown) => void;
  resetKey: string;
  /** A problem with the parsed value that keeps it out (a beat without its narration). */
  check?: (v: unknown) => string | null;
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
    const problem = check?.(v);
    if (problem) return setError(problem);
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

/* ---------- regenerate a beat (the rewrite job runs in the tray; the page follows it) ---------- */

export interface RegenState {
  /** A rewrite of this beat is running. */
  busy: boolean;
  error: string;
  /** Unsaved edits: the job rewrites the saved lesson, so they are saved first. */
  disabled: boolean;
  /** What it costs, said beside the button ("about $0.004"). */
  cost?: string;
  /** What should change (the page keeps it: the judge's note can fill it). */
  instruction: string;
  setInstruction: (s: string) => void;
  start: (instruction: string) => Promise<void>;
  /** The book (its writer's service decides whether writing again needs the internet). */
  book?: ProjectDetail | null;
}

export function Regenerate({ regen }: { regen: RegenState }) {
  const { t } = useI18n();
  // offline: writing a beat again needs the internet
  const net = useNetGate('regen-net', regen.book ?? null, 'rewrite');
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
            value={regen.instruction}
            placeholder={t('editor.regenPlaceholder')}
            dir="auto"
            onChange={(e) => regen.setInstruction(e.target.value)}
          />
        )}
      </Field>
      <div className="actions">
        <Button
          icon="regenerate"
          busy={regen.busy}
          disabled={regen.disabled}
          className={net.blocked ? 'is-blocked' : undefined}
          {...net.props}
          onClick={() => {
            if (!net.blocked) void regen.start(regen.instruction);
          }}
        >
          {t('editor.regenBtn')}
        </Button>
        {regen.cost && <span className="mono muted small">{regen.cost}</span>}
        {net.chip}
      </div>
      <p className="hint">{regen.disabled ? t('editor.regenSaveFirst') : t('editor.regenHint')}</p>
      {regen.error && <Notice tone="error">{regen.error}</Notice>}
    </section>
  );
}

/** A new version of the beat is waiting: see it on the stage (Before / After), then keep one, or try again. */
export interface CompareState {
  /** Its narration, and what was asked. */
  narration: string;
  instruction?: string;
  view: 'before' | 'after';
  setView: (v: 'before' | 'after') => void;
  keepNew: () => void;
  keepOld: () => void;
  again: () => void;
  /** Unsaved edits wait for a save first (keeping a version rewrites the saved lesson). */
  disabled: boolean;
  /** The beat was saved with changes after the new version was written. */
  changed?: boolean;
  /** Keeping it failed (it no longer fits the beats after it, …). */
  error?: string;
  /** The book (Try again writes the beat again: offline, it may wait for the internet). */
  book?: ProjectDetail | null;
}

function Compare({ c, current, lang }: { c: CompareState; current: string; lang: string }) {
  const { t } = useI18n();
  // offline: trying again writes the beat again
  const retryNet = useNetGate('retry-net', c.book ?? null, 'rewrite');
  return (
    <section className="insp-sec compare" aria-labelledby="compare-title">
      <h3 id="compare-title" className="insp-title">
        {t('editor.candidate')}
      </h3>
      {c.instruction && (
        <p className="hint">
          <bdi dir="auto">{c.instruction}</bdi>
        </p>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form group */}
      <div className="seg compare-seg" role="group" aria-label={t('editor.compareView')}>
        {(['before', 'after'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={c.view === v} onClick={() => c.setView(v)}>
            {t(v === 'before' ? 'improve.before' : 'improve.after')}
          </button>
        ))}
      </div>
      <div className="compare-text">
        {(
          [
            ['before', current],
            ['after', c.narration],
          ] as const
        ).map(([v, text]) => (
          <div key={v} className={c.view === v ? 'is-on' : ''}>
            <span className="compare-k">{t(v === 'before' ? 'improve.before' : 'improve.after')}</span>
            <p lang={lang} dir={dirOf(lang)}>
              {text.replace(/\[\[[A-Za-z][\w-]{0,31}\]\]/g, '')}
            </p>
          </div>
        ))}
      </div>
      {c.changed && <Notice tone="warn">{t('editor.candidateChanged')}</Notice>}
      {c.error && <Notice tone="error">{c.error}</Notice>}
      <div className="actions">
        <Button variant="primary" disabled={c.disabled} onClick={c.keepNew}>
          {t('editor.keepNew')}
        </Button>
        <Button disabled={c.disabled} onClick={c.keepOld}>
          {t('editor.keepOld')}
        </Button>
        <Button
          variant="quiet"
          icon="regenerate"
          disabled={c.disabled}
          className={retryNet.blocked ? 'is-blocked' : undefined}
          {...retryNet.props}
          onClick={() => {
            if (!retryNet.blocked) c.again();
          }}
        >
          {t('common.retry')}
        </Button>
        {retryNet.chip}
      </div>
      {c.disabled && <p className="hint">{t('editor.regenSaveFirst')}</p>}
    </section>
  );
}

/* ---------- the inspector ---------- */

export function Inspector({
  beat,
  index,
  lessonLang,
  langs,
  moves,
  issues,
  catalog,
  parts,
  allIds,
  allQuestionIds,
  update,
  replace,
  renameNode,
  onGoTo,
  moveKeys,
  renameKeys,
  regen,
  compare,
  selMark,
  onSelectMark,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  beat: Beat;
  index: number;
  lessonLang: string;
  /** The languages its text is translated into. */
  langs: string[];
  moves: string[];
  /** This beat's problems (those with a path show on their field). */
  issues: Issue[];
  catalog: EditorCatalog | null;
  /** What is on the stage during this beat. */
  parts: StagePart[];
  /** Ids of every part added in the lesson, and of every question (new ones must not take them). */
  allIds: string[];
  allQuestionIds: string[];
  update: (fn: (b: Beat) => void) => void;
  /** The whole beat, from "Edit as JSON". */
  replace: (b: Beat) => void;
  renameNode: (from: string, to: string) => void;
  onGoTo: (beat: number) => void;
  /** Translations keyed by a cue's place follow it; returns how to take the change back. */
  moveKeys: (moves: KeyMove[]) => () => void;
  /** A question's translations follow its new id. */
  renameKeys: (kind: 'q', from: string, to: string) => void;
  regen: RegenState;
  /** A new version of this beat waiting to be compared. */
  compare?: CompareState;
  /** The mark chosen (narration, timeline, a cue): its cues stand out. */
  selMark: string | null;
  onSelectMark: (m: string | null) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { t } = useI18n();
  const [json, setJson] = useState(false);
  // parts added in this beat that the last check has not seen yet are on the stage too
  const nodes: StagePart[] = [
    ...parts,
    ...(beat.scene?.add ?? [])
      .filter((n) => !parts.some((p) => p.id === n.id))
      .map((n) => ({ id: n.id, type: n.type, parts: [], from: index })),
  ];
  if (json)
    return (
      <div className="inspector">
        <section className="insp-sec">
          <JsonField
            label={t('editor.beatJson')}
            shape="object"
            value={beat}
            resetKey={`${index}-json`}
            check={(v) => {
              const p = beatProblem(v);
              return p ? t('editor.jsonBeat', { field: p }) : null;
            }}
            onValid={(v) => replace(v as Beat)}
          />
          <Button icon="back" className="flip-rtl-icon" onClick={() => setJson(false)}>
            {t('editor.backToForm')}
          </Button>
        </section>
      </div>
    );
  return (
    <div className="inspector">
      {compare && <Compare c={compare} current={beat.narration} lang={lessonLang} />}
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

      <StageSection
        beat={beat}
        index={index}
        lang={lessonLang}
        langs={langs}
        catalog={catalog}
        parts={parts}
        allIds={allIds}
        issues={issues}
        update={update}
        renameNode={renameNode}
        onGoTo={onGoTo}
        moveKeys={moveKeys}
      />

      <CuesSection
        beat={beat}
        nodes={nodes}
        catalog={catalog}
        lang={lessonLang}
        langs={langs}
        update={update}
        moveKeys={moveKeys}
        selMark={selMark}
        onSelectMark={onSelectMark}
      />

      <QuestionsSection
        beat={beat}
        index={index}
        lang={lessonLang}
        langs={langs}
        catalog={catalog}
        issues={issues}
        allQuestionIds={allQuestionIds}
        update={update}
        renameKeys={renameKeys}
      />

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

      <section className="insp-sec insp-tools">
        <Button variant="quiet" icon="file" onClick={() => setJson(true)}>
          {t('editor.editJson')}
        </Button>
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
