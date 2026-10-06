// "What each mark does": the beat's cues by mark (then those at other times), each opening its editor: when,
// what it does, on which part, its arguments (from the action's definition) and how long it takes.
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import type { EditorCatalog, StagePart } from '../../../shared/types';
import { useToast } from '../../components/overlays';
import { Button } from '../../components/ui';
import { useI18n } from '../../i18n';
import { en, type MsgKey } from '../../messages';
import { defaultFor, NumberInput, ObjectForm } from './SchemaForm';
import {
  type Beat,
  type Cue,
  cueDuration,
  cueRemovalMoves,
  type KeyMove,
  markOfCue,
  marksOf,
  targetText,
} from './shared';

/** An action's name: a generic one (show, highlight…), else a component's (step, hop…), else itself. */
export function useActionName() {
  const { t } = useI18n();
  return (a: string) => (`cue.${a}` in en ? t(`cue.${a}` as MsgKey) : `act.${a}` in en ? t(`act.${a}` as MsgKey) : a);
}

const isMark = (at: Cue['at']) => typeof at === 'object' || (typeof at === 'string' && at !== 'start' && at !== 'end');

function CueEditor({
  cue,
  marks,
  nodes,
  catalog,
  lang,
  langs,
  onChange,
  onRemove,
  onDone,
  focusWhen,
}: {
  /** Set when "When" moved the cue under another mark: its editor opens there with the focus back on "When". */
  focusWhen: { current: boolean };
  cue: Cue;
  marks: string[];
  nodes: StagePart[];
  catalog: EditorCatalog | null;
  lang: string;
  langs: string[];
  onChange: (c: Cue) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const actionName = useActionName();
  const id = useId();
  const [node, part = ''] = cue.target.split('#') as [string, string?];
  const on = nodes.find((n) => n.id === node);
  const actionsOf = (n: StagePart | undefined) => catalog?.components.find((c) => c.type === n?.type)?.actions ?? {};
  const own = actionsOf(on);
  const actions = [...(catalog?.generic ?? []), ...Object.keys(own)];
  const comp = own[cue.do];
  const generic = catalog?.generic.includes(cue.do) ?? true;
  const when = typeof cue.at === 'number' ? '#sec' : isMark(cue.at) ? `m:${markOfCue(cue)}` : String(cue.at);
  const offset = typeof cue.at === 'object' ? (cue.at.offset ?? 0) : 0;
  const set = (patch: Partial<Cue>) => onChange({ ...cue, ...patch });
  // a cue moved to another mark is drawn under it: the focus comes back to "When"
  const whenRef = useRef<HTMLSelectElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the editor opens under its new mark
  useEffect(() => {
    if (!focusWhen.current) return;
    focusWhen.current = false;
    whenRef.current?.focus();
  }, []);
  const row = (label: ReactNode, control: ReactNode, k: string) => (
    <div className="sf-field">
      <label className="sf-label" htmlFor={`${id}-${k}`}>
        {label}
      </label>
      {control}
    </div>
  );
  return (
    <div className="cue-editor">
      {row(
        t('editor.cue.when'),
        <div className="cue-when">
          <select
            id={`${id}-when`}
            ref={whenRef}
            value={when}
            onChange={(e) => {
              const v = e.target.value;
              // under another mark (or among the other times) the editor opens again there
              const group = (x: string) => (x.startsWith('m:') && marks.includes(x.slice(2)) ? x : 'other');
              focusWhen.current = group(v) !== group(when);
              if (v === '#sec') set({ at: 1 });
              else if (v === 'start' || v === 'end') set({ at: v });
              else set({ at: v.slice(2) });
            }}
          >
            {marks.map((m) => (
              <option key={m} value={`m:${m}`}>
                {t('editor.cue.onMark', { mark: m })}
              </option>
            ))}
            <option value="start">{t('editor.cue.start')}</option>
            <option value="end">{t('editor.cue.end')}</option>
            <option value="#sec">{t('editor.cue.seconds')}</option>
          </select>
          {isMark(cue.at) && (
            <div className="cue-num">
              <label htmlFor={`${id}-offset`}>{t('editor.cue.offset')}</label>
              <NumberInput
                id={`${id}-offset`}
                value={offset}
                required
                onChange={(o) => {
                  const mark = markOfCue(cue)!;
                  set({ at: o ? { mark, offset: Math.max(-5, Math.min(8, o)) } : mark });
                }}
              />
            </div>
          )}
          {typeof cue.at === 'number' && (
            <div className="cue-num">
              <label htmlFor={`${id}-sec`}>{t('editor.cue.sec')}</label>
              <NumberInput
                id={`${id}-sec`}
                value={cue.at}
                required
                onChange={(n) => set({ at: Math.max(0, Math.min(120, n ?? 0)) })}
              />
            </div>
          )}
        </div>,
        'when',
      )}
      {row(
        t('editor.cue.on'),
        <div className="cue-on">
          <select
            id={`${id}-on`}
            value={node}
            onChange={(e) => {
              const next = nodes.find((n) => n.id === e.target.value);
              // an action of the old part's own does not exist on another kind of part: it shows instead
              const keeps = catalog?.generic.includes(cue.do) || cue.do in actionsOf(next);
              const { args: _a, ...rest } = cue;
              onChange(keeps ? { ...cue, target: e.target.value } : { ...rest, target: e.target.value, do: 'show' });
            }}
          >
            {!on && <option value={node}>{node}</option>}
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id}
              </option>
            ))}
          </select>
          {on && on.parts.length > 0 && (
            <select
              aria-label={t('editor.cue.part')}
              value={part}
              onChange={(e) => set({ target: e.target.value ? `${node}#${e.target.value}` : node })}
            >
              <option value="">{t('editor.cue.whole')}</option>
              {on.parts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
        </div>,
        'on',
      )}
      {row(
        t('editor.cue.action'),
        <select
          id={`${id}-action`}
          value={cue.do}
          onChange={(e) => {
            const a = e.target.value;
            const args = own[a]?.args;
            const { args: _old, ...rest } = cue;
            const next = (args ? defaultFor(args) : undefined) as Record<string, unknown> | undefined;
            onChange({ ...rest, do: a, ...(next && Object.keys(next).length ? { args: next } : {}) });
          }}
        >
          {!actions.includes(cue.do) && <option value={cue.do}>{cue.do}</option>}
          {actions.map((a) => (
            <option key={a} value={a}>
              {actionName(a)}
            </option>
          ))}
        </select>,
        'action',
      )}
      {generic &&
        (cue.do === 'color' || cue.do === 'highlight') &&
        row(
          t('prop.color'),
          <select
            id={`${id}-color`}
            value={String(cue.args?.color ?? '')}
            onChange={(e) => {
              const { args: _a, ...rest } = cue;
              onChange(e.target.value ? { ...rest, args: { ...cue.args, color: e.target.value } } : rest);
            }}
          >
            {/* no colour given: the highlight's own (the compiler's "task") */}
            <option value="">{t('form.default', { value: t('color.task') })}</option>
            {catalog?.colors
              .filter((c) => c !== 'task')
              .map((c) => (
                <option key={c} value={c}>
                  {t(`color.${c}` as MsgKey)}
                </option>
              ))}
          </select>,
          'color',
        )}
      {comp && (
        <div className="cue-args">
          <ObjectForm
            schema={comp.args}
            value={(cue.args ?? {}) as Record<string, unknown>}
            ctx={{ lang, ...(comp.text ? { text: comp.text.map((p) => p) } : {}), langs }}
            onChange={(v) => onChange({ ...cue, args: v })}
          />
        </div>
      )}
      {row(
        t('editor.cue.duration'),
        <NumberInput
          id={`${id}-dur`}
          placeholder={String(cueDuration({ ...cue, dur: undefined } as Cue, comp?.dur) ?? '')}
          value={typeof cue.dur === 'number' ? cue.dur : undefined}
          onChange={(d) => {
            const { dur: _d, ...rest } = cue;
            onChange(d === undefined ? rest : { ...rest, dur: Math.max(0, Math.min(8, d)) });
          }}
        />,
        'dur',
      )}
      <div className="cue-tools">
        <Button variant="primary" onClick={onDone}>
          {t('editor.cue.done')}
        </Button>
        <Button variant="quiet" icon="close" className="insp-delete" onClick={onRemove}>
          {t('editor.cue.remove')}
        </Button>
      </div>
    </div>
  );
}

export function CuesSection({
  beat,
  nodes,
  catalog,
  lang,
  langs,
  update,
  moveKeys,
  selMark,
  onSelectMark,
}: {
  /** The mark chosen (narration, timeline): its cues stand out; a cue opened chooses its mark. */
  selMark: string | null;
  onSelectMark: (m: string | null) => void;
  beat: Beat;
  /** What is on the stage during this beat (cues move it). */
  nodes: StagePart[];
  catalog: EditorCatalog | null;
  lang: string;
  langs: string[];
  update: (fn: (b: Beat) => void) => void;
  /** Translations keyed by a cue's place follow it (a removed cue's are dropped); returns how to take them back. */
  moveKeys: (moves: KeyMove[]) => () => void;
}) {
  const { t, num } = useI18n();
  const toast = useToast();
  const actionName = useActionName();
  const [editing, setEditing] = useState<number | null>(null);
  const focusWhen = useRef(false);
  const marks = marksOf(beat.narration);
  const cues = beat.cues ?? [];
  // a component's own action takes its usual time (equation step, number line hop…)
  const actionDur = (c: Cue) => {
    const on = nodes.find((n) => n.id === c.target.split('#')[0]);
    return on ? catalog?.components.find((x) => x.type === on.type)?.actions[c.do]?.dur : undefined;
  };
  const add = (at: Cue['at']) => {
    const first = nodes[0]?.id;
    if (!first) return;
    update((b) => {
      b.cues = [...(b.cues ?? []), { at, do: 'show', target: first }];
    });
    setEditing(cues.length);
  };
  const remove = (k: number) => {
    const gone = cues[k]!;
    const back = moveKeys(cueRemovalMoves(beat.id, [k], cues.length));
    update((b) => {
      b.cues = (b.cues ?? []).filter((_, j) => j !== k);
    });
    setEditing(null);
    toast({
      text: t('editor.cueRemoved', { what: actionName(gone.do) }),
      action: {
        label: t('common.undo'),
        run: () => {
          back();
          update((b) => {
            const list = [...(b.cues ?? [])];
            list.splice(k, 0, gone);
            b.cues = list;
          });
        },
      },
    });
  };
  const line = (c: Cue, k: number) => {
    const d = cueDuration(c, actionDur(c));
    const open = editing === k;
    const off = typeof c.at === 'object' ? (c.at.offset ?? 0) : 0;
    return (
      <li key={k} className={`cue-row${open ? ' is-open' : ''}`}>
        <button
          type="button"
          className="cue-line"
          aria-expanded={open}
          onClick={() => {
            setEditing(open ? null : k);
            const m = markOfCue(c);
            if (m && !open) onSelectMark(m);
          }}
        >
          <span className="cue-what">{actionName(c.do)}</span>
          <code className="cue-target" dir="ltr">
            {targetText(c.target)}
          </code>
          {off ? (
            <span className="muted small">
              {' '}
              {t('editor.at', { at: t('editor.sec', { n: `${off > 0 ? '+' : '−'}${num(Math.abs(off))}` }) })}
            </span>
          ) : null}
          <span className="cue-dur mono">{d === null ? t('editor.cue.instant') : t('editor.sec', { n: num(d) })}</span>
        </button>
        {open && (
          <CueEditor
            cue={c}
            marks={marks}
            nodes={nodes}
            catalog={catalog}
            lang={lang}
            langs={langs}
            onChange={(next) =>
              update((b) => {
                b.cues![k] = next;
              })
            }
            onRemove={() => remove(k)}
            onDone={() => setEditing(null)}
            focusWhen={focusWhen}
          />
        )}
      </li>
    );
  };
  const other = cues.map((c, k) => [c, k] as const).filter(([c]) => !marks.includes(markOfCue(c) ?? ''));
  const empty = !nodes.length;
  return (
    <section className="insp-sec" aria-labelledby="cues-title">
      <h3 id="cues-title" className="insp-title">
        {t('editor.cuesTitle')}
      </h3>
      {!marks.length && !cues.length && <p className="muted">{t('editor.noMarks')}</p>}
      <ul className="cue-groups">
        {marks.map((m) => {
          const mine = cues.map((c, k) => [c, k] as const).filter(([c]) => markOfCue(c) === m);
          return (
            <li key={m} className={`cue-group${m === selMark ? ' is-sel' : ''}`}>
              <span className="mark-chip" dir="ltr">
                {m}
              </span>
              {mine.length ? (
                <ul className="cue-list">{mine.map(([c, k]) => line(c, k))}</ul>
              ) : (
                <span className="cue-none">
                  <span className="warn small">{t('editor.noCues')}</span>
                  {!empty && (
                    <Button variant="quiet" icon="plus" onClick={() => add(m)}>
                      {t('editor.addCueFor', { mark: m })}
                    </Button>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {other.length > 0 && (
          <li className="cue-group">
            <span className="small muted">{t('editor.otherCues')}</span>
            <ul className="cue-list">{other.map(([c, k]) => line(c, k))}</ul>
          </li>
        )}
      </ul>
      {empty ? (
        <p className="hint">{t('editor.cueNeedsPart')}</p>
      ) : (
        <Button variant="quiet" icon="plus" className="add-cue" onClick={() => add(marks[0] ?? 'start')}>
          {t('editor.addCue')}
        </Button>
      )}
    </section>
  );
}
