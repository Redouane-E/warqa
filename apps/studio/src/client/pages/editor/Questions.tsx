// The beat's questions: each one's form generated from the definition of its kind (choice, blanks, numeric…),
// a new question of any kind, and where its card goes.
import { useState } from 'react';
import type { EditorCatalog, Issue, JsonSchema } from '../../../shared/types';
import { useToast } from '../../components/overlays';
import { Button, Icon } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { MsgKey } from '../../messages';
import { defaultFor, ObjectForm } from './SchemaForm';
import { type Beat, freshId } from './shared';

type Q = Record<string, unknown> & { kind: string; id?: string; prompt?: string };

/** The definition of one kind of question (the variant of the union whose `kind` it is). */
const kindSchema = (catalog: EditorCatalog | null, kind: string): JsonSchema | undefined =>
  ((catalog?.question.oneOf ?? catalog?.question.anyOf) as JsonSchema[] | undefined)?.find(
    (v) => ((v.properties as Record<string, JsonSchema> | undefined)?.kind as JsonSchema | undefined)?.const === kind,
  );

export function QuestionsSection({
  beat,
  index,
  lang,
  langs,
  catalog,
  issues,
  allQuestionIds,
  update,
  renameKeys,
}: {
  beat: Beat;
  index: number;
  lang: string;
  langs: string[];
  catalog: EditorCatalog | null;
  issues: Issue[];
  allQuestionIds: string[];
  update: (fn: (b: Beat) => void) => void;
  /** A question's translations follow a new id ("q.<id>.…"). */
  renameKeys: (kind: 'q', from: string, to: string) => void;
}) {
  const { t, num } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState<number | null>(null);
  const [kind, setKind] = useState('');
  const questions = (beat.questions ?? []) as Q[];
  const kinds = (((catalog?.question.oneOf ?? catalog?.question.anyOf) as JsonSchema[] | undefined) ?? [])
    .map((v) => String(((v.properties as Record<string, JsonSchema>).kind as JsonSchema).const))
    .filter(Boolean);
  const card = (beat.card ?? {}) as { place?: string; label?: string };
  const cardSchema = (catalog?.card.properties ?? {}) as Record<string, JsonSchema>;
  const errorAt = (k: number) => (path: string) => {
    const full = `beats.${index}.questions.${k}${path ? `.${path}` : ''}`;
    const hit = issues.find((x) => x.path === full);
    return hit ? hit.message.replace(/^[^:]*:\s*/, '') : undefined;
  };
  const add = () => {
    const schema = kindSchema(catalog, kind);
    if (!schema) return;
    const q = defaultFor(schema) as Q;
    q.kind = kind;
    q.id = freshId('q', allQuestionIds);
    update((b) => {
      b.questions = [...((b.questions ?? []) as Q[]), q];
    });
    setOpen(questions.length);
    setKind('');
  };
  return (
    <section className="insp-sec" aria-labelledby="questions-title">
      <h3 id="questions-title" className="insp-title">
        {t('editor.questionsTitle')}
      </h3>
      {questions.length > 0 && (
        <ol className="part-rows">
          {questions.map((q, k) => {
            const isOpen = open === k;
            const schema = kindSchema(catalog, q.kind);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: questions are edited in place
              <li key={k} className={`part-row${isOpen ? ' is-open' : ''}`}>
                <span className="part-tile mono" aria-hidden="true">
                  {num(k + 1)}
                </span>
                <span className="part-text">
                  <span className="part-name">{t(`q.kind.${q.kind}` as MsgKey)}</span>
                  <bdi className="part-sum" lang={lang} dir="auto">
                    {q.prompt || '…'}
                  </bdi>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-expanded={isOpen}
                  aria-label={t('editor.editQuestion', { n: k + 1 })}
                  onClick={() => setOpen(isOpen ? null : k)}
                >
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('editor.removeQuestion', { n: k + 1 })}
                  onClick={() => {
                    const before = { questions: beat.questions, card: beat.card };
                    update((b) => {
                      const left = ((b.questions ?? []) as Q[]).filter((_, j) => j !== k);
                      if (left.length) b.questions = left;
                      else {
                        delete b.questions;
                        delete b.card;
                      }
                    });
                    setOpen(null);
                    toast({
                      text: t('editor.questionRemoved', { n: k + 1 }),
                      action: {
                        label: t('common.undo'),
                        run: () =>
                          update((b) => {
                            if (before.questions) b.questions = before.questions;
                            if (before.card) b.card = before.card;
                          }),
                      },
                    });
                  }}
                >
                  <Icon name="close" />
                </button>
                {isOpen && schema && (
                  <div className="node-editor">
                    <ObjectForm
                      schema={schema}
                      value={q}
                      ctx={{ lang, langs, text: QUESTION_TEXT, errorAt: errorAt(k) }}
                      onChange={(v) => {
                        const next = v as Q;
                        // a question's translations are keyed by its id: they follow a new one
                        if (q.id && next.id && next.id !== q.id) renameKeys('q', q.id, next.id);
                        update((b) => {
                          (b.questions as Q[])[k] = next;
                        });
                      }}
                      skip={['kind']}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {questions.length > 0 && (
        <div className="node-place">
          {(['place', 'label'] as const).map((k) => (
            <div key={k} className="sf-field">
              <label className="sf-label" htmlFor={`card-${k}`}>
                {t(`editor.card.${k}` as MsgKey)}
              </label>
              <select
                id={`card-${k}`}
                value={card[k] ?? String(cardSchema[k]?.default ?? '')}
                onChange={(e) =>
                  update((b) => {
                    b.card = { ...((b.card ?? {}) as object), [k]: e.target.value };
                  })
                }
              >
                {((cardSchema[k]?.enum ?? []) as string[]).map((v) => (
                  <option key={v} value={v}>
                    {t(`enum.${v}` as MsgKey)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {catalog && (
        <div className="part-add">
          <label className="visually-hidden" htmlFor="question-add">
            {t('editor.addQuestion')}
          </label>
          <select id="question-add" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t('editor.pickKind')}</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {t(`q.kind.${k}` as MsgKey)}
              </option>
            ))}
          </select>
          <Button icon="plus" disabled={!kind} onClick={add}>
            {t('editor.addQuestion')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** The parts of a question that are translated (as `collectStrings` reads them). */
const QUESTION_TEXT = [
  'prompt',
  'hint',
  'explain',
  'unit',
  'options.*.text',
  'options.*.why',
  'rows.*.template',
  'rows.*.text',
  'rows.*.why',
  'rows.*.explain',
  'rows.*.hint',
  'rows.*.answers.*.text.*',
  'cols.*.text',
  'items.*.text',
  'wrong.*',
  'accept.*',
];
