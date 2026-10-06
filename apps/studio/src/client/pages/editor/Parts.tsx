// "On the stage": the parts a beat shows (those it adds, editable here, and those kept from earlier beats), each
// with a form generated from its component's definition; "Add to the stage" from the catalog.
import { useEffect, useState } from 'react';
import type { ComponentInfo, EditorCatalog, Issue, StagePart } from '../../../shared/types';
import { useToast } from '../../components/overlays';
import { Button, Icon } from '../../components/ui';
import { useI18n } from '../../i18n';
import { en, type MsgKey } from '../../messages';
import { ObjectForm } from './SchemaForm';
import { type Beat, type Cue, cueRemovalMoves, freshId, type KeyMove, markOfCue, type SceneNode } from './shared';

const ID = /^[a-z][a-z0-9_-]{0,31}$/;

/** A component's name in the interface's language (its type when the catalog has none, e.g. a pack's). */
export function useCompName() {
  const { t } = useI18n();
  return (type: string) => (`comp.${type}` in en ? t(`comp.${type}` as MsgKey) : type);
}

/** When a part appears: at the start, on the mark of the cue that shows it, or on a cue. */
function useAppears() {
  const { t } = useI18n();
  return (n: SceneNode, cues: Cue[]) => {
    const shown = cues.find((c) => (c.do === 'show' || c.do === 'draw') && c.target === n.id);
    const mark = shown && markOfCue(shown);
    if (mark) return t('editor.appearsMark', { mark: `\u2066${mark}\u2069` });
    return n.enter === 'cue' ? t('editor.appearsCue') : t('editor.appearsStart');
  };
}

/** A few words about a part: "3 steps", "−8 to 8", "4 items". */
function useSummary() {
  const { t, num } = useI18n();
  return (n: SceneNode): string => {
    if (Array.isArray(n.steps)) return t('editor.stepsN', { n: n.steps.length });
    if (typeof n.min === 'number' && typeof n.max === 'number')
      return t('editor.range', { min: num(n.min), max: num(n.max) });
    if (Array.isArray(n.items)) return t('editor.itemsN', { n: n.items.length });
    return '';
  };
}

function NodeEditor({
  node,
  info,
  lang,
  langs,
  slots,
  taken,
  errorAt,
  onChange,
  onRename,
}: {
  node: SceneNode;
  info: ComponentInfo | undefined;
  lang: string;
  langs: string[];
  slots: string[];
  /** Ids already used in the lesson (a rename must not take one). */
  taken: string[];
  errorAt: (path: string) => string | undefined;
  onChange: (n: SceneNode) => void;
  onRename: (to: string) => void;
}) {
  const { t } = useI18n();
  const [id, setId] = useState(node.id);
  const [idError, setIdError] = useState('');
  useEffect(() => setId(node.id), [node.id]);
  // a new id is taken when the field is left: the cues and questions that point at the part follow it
  const commit = () => {
    if (id === node.id) return setIdError('');
    if (!ID.test(id)) return setIdError(t('editor.idRule'));
    if (taken.includes(id)) return setIdError(t('editor.idTaken'));
    setIdError('');
    onRename(id);
  };
  return (
    <div className="node-editor">
      <div className="sf-field">
        <label className="sf-label" htmlFor={`node-id-${node.id}`}>
          {t('prop.id')}
        </label>
        <input
          id={`node-id-${node.id}`}
          className="code"
          dir="ltr"
          spellCheck={false}
          value={id}
          aria-invalid={!!idError}
          onChange={(e) => setId(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        {idError && (
          <span className="sf-error" role="alert">
            <Icon name="error" size={16} /> {idError}
          </span>
        )}
      </div>
      <div className="node-place">
        <div className="sf-field">
          <label className="sf-label" htmlFor={`node-slot-${node.id}`}>
            {t('prop.slot')}
          </label>
          <select
            id={`node-slot-${node.id}`}
            value={node.slot ?? ''}
            onChange={(e) => {
              const { slot: _slot, ...rest } = node;
              onChange(e.target.value ? { ...rest, slot: e.target.value } : (rest as SceneNode));
            }}
          >
            <option value="">
              {t('editor.slotAuto', { slot: t(`slot.${info?.defaultSlot ?? 'main'}` as MsgKey) })}
            </option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {t(`slot.${s}` as MsgKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="sf-field">
          <label className="sf-label" htmlFor={`node-enter-${node.id}`}>
            {t('prop.enter')}
          </label>
          <select
            id={`node-enter-${node.id}`}
            value={node.enter ?? 'auto'}
            onChange={(e) => onChange({ ...node, enter: e.target.value })}
          >
            <option value="auto">{t('editor.enterAuto')}</option>
            <option value="cue">{t('editor.enterCue')}</option>
          </select>
        </div>
      </div>
      {info ? (
        <ObjectForm
          schema={info.props}
          value={node}
          ctx={{ lang, text: info.text, langs, errorAt }}
          onChange={(v) => onChange(v as SceneNode)}
          skip={['id', 'type', 'slot', 'enter']}
        />
      ) : (
        <p className="hint">{t('editor.unknownComp', { type: node.type })}</p>
      )}
    </div>
  );
}

export function StageSection({
  beat,
  index,
  lang,
  langs,
  catalog,
  parts,
  allIds,
  issues,
  update,
  renameNode,
  onGoTo,
  moveKeys,
}: {
  beat: Beat;
  index: number;
  lang: string;
  /** The languages its text is translated into. */
  langs: string[];
  catalog: EditorCatalog | null;
  /** What is on the stage during this beat (from the server's last check). */
  parts: StagePart[];
  allIds: string[];
  issues: Issue[];
  update: (fn: (b: Beat) => void) => void;
  renameNode: (from: string, to: string) => void;
  onGoTo: (beat: number) => void;
  /** Translations keyed by a cue's place follow it; returns how to take the change back. */
  moveKeys: (moves: KeyMove[]) => () => void;
}) {
  const { t, num } = useI18n();
  const toast = useToast();
  const compName = useCompName();
  const appears = useAppears();
  const summary = useSummary();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const added = beat.scene?.add ?? [];
  const kept = parts.filter((p) => p.from < index && !added.some((n) => n.id === p.id));
  const byType = new Map(catalog?.components.map((c) => [c.type, c]) ?? []);
  // a problem with a path inside a part ("beats.2.scene.add.0.steps") shows on its field
  const errorAt = (k: number) => (path: string) => {
    const full = `beats.${index}.scene.add.${k}${path ? `.${path}` : ''}`;
    const hit = issues.find((x) => x.path === full);
    return hit ? hit.message.replace(/^[^:]*:\s*/, '') : undefined;
  };
  const add = () => {
    const info = byType.get(adding);
    if (!info) return;
    const id = freshId(adding.slice(0, 8).replace(/[^a-z0-9]/g, '') || 'part', allIds);
    update((b) => {
      b.scene ??= {};
      b.scene.add = [...(b.scene.add ?? []), { id, type: adding, ...structuredClone(info.example) }];
    });
    setOpen(id);
    setAdding('');
  };
  return (
    <section className="insp-sec" aria-labelledby="stage-parts-title">
      <h3 id="stage-parts-title" className="insp-title">
        {t('editor.onStage')}
      </h3>
      <label className="check">
        <input
          type="checkbox"
          checked={!!beat.scene?.clear}
          onChange={(e) =>
            update((b) => {
              b.scene ??= {};
              b.scene.clear = e.target.checked;
            })
          }
        />
        <span>{t('editor.clearStage')}</span>
      </label>
      <ul className="part-rows">
        {kept.map((p) => (
          <li key={p.id} className="part-row is-kept">
            <span className="part-tile" aria-hidden="true">
              <Icon name="file" size={16} />
            </span>
            <span className="part-text">
              <span className="part-name">
                {compName(p.type)} <code dir="ltr">{p.id}</code>
              </span>
              <span className="part-sum">{t('editor.keptFrom', { n: num(p.from + 1) })}</span>
            </span>
            <Button variant="quiet" onClick={() => onGoTo(p.from)}>
              {t('editor.goToBeat', { n: num(p.from + 1) })}
            </Button>
          </li>
        ))}
        {added.map((n, k) => {
          const isOpen = open === n.id;
          const sum = summary(n);
          return (
            // a part keeps its row (and the focus) while its id is renamed
            // biome-ignore lint/suspicious/noArrayIndexKey: the place of the part in the beat
            <li key={k} className={`part-row${isOpen ? ' is-open' : ''}`}>
              <span className="part-tile" aria-hidden="true">
                <Icon name="file" size={16} />
              </span>
              <span className="part-text">
                <span className="part-name">
                  {compName(n.type)} <code dir="ltr">{n.id}</code>
                </span>
                <span className="part-sum">
                  {appears(n, beat.cues ?? [])}
                  {sum && ` · ${sum}`}
                </span>
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-expanded={isOpen}
                aria-label={t('editor.editNode', { name: `${compName(n.type)} ${n.id}` })}
                onClick={() => setOpen(isOpen ? null : n.id)}
              >
                <Icon name="edit" />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('editor.removeNode', { name: `${compName(n.type)} ${n.id}` })}
                onClick={() => {
                  // its cues in this beat would point at nothing: they go with it (and come back with Undo)
                  const cues = beat.cues ?? [];
                  const mine = cues.flatMap((c, j) => (c.target.split('#')[0] === n.id ? [j] : []));
                  const back = moveKeys(cueRemovalMoves(beat.id, mine, cues.length));
                  update((b) => {
                    b.scene!.add = (b.scene?.add ?? []).filter((_, j) => j !== k);
                    b.cues = (b.cues ?? []).filter((_, j) => !mine.includes(j));
                  });
                  setOpen(null);
                  toast({
                    text: t('editor.partRemoved', { name: `${compName(n.type)} ${n.id}` }),
                    action: {
                      label: t('common.undo'),
                      run: () => {
                        back();
                        update((b) => {
                          b.scene ??= {};
                          const add = [...(b.scene.add ?? [])];
                          add.splice(k, 0, n);
                          b.scene.add = add;
                          b.cues = cues;
                        });
                      },
                    },
                  });
                }}
              >
                <Icon name="close" />
              </button>
              {isOpen && (
                <NodeEditor
                  node={n}
                  info={byType.get(n.type)}
                  lang={lang}
                  langs={langs}
                  slots={catalog?.slots ?? []}
                  taken={allIds.filter((x) => x !== n.id)}
                  errorAt={errorAt(k)}
                  onChange={(next) =>
                    update((b) => {
                      b.scene!.add![k] = next;
                    })
                  }
                  onRename={(to) => {
                    renameNode(n.id, to);
                    setOpen(to);
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      {catalog && (
        <div className="part-add">
          <label className="visually-hidden" htmlFor="part-add">
            {t('editor.addToStage')}
          </label>
          <select id="part-add" value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{t('editor.pickPart')}</option>
            {catalog.components
              .map((c) => ({ type: c.type, name: compName(c.type) }))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.type} value={c.type}>
                  {c.name}
                </option>
              ))}
          </select>
          <Button icon="plus" disabled={!adding} onClick={add}>
            {t('editor.addToStage')}
          </Button>
        </div>
      )}
    </section>
  );
}
