// Forms generated from JSON Schemas (a component's props, an action's arguments, a question): text, numbers,
// choices, yes/no, lists, groups, pairs, tables of named values, any value, and "one of several kinds". Labels come
// from the catalog (prop.<name>), else the property's own name; fields the lesson translates say into which
// languages; a problem whose path points at a field shows under it.
import { type ReactNode, useEffect, useId, useState } from 'react';
import type { JsonSchema } from '../../../shared/types';
import { Button, Icon } from '../../components/ui';
import { useI18n } from '../../i18n';
import { en, type MsgKey } from '../../messages';
import {
  defaultFor,
  isAny,
  numberOf,
  type Path,
  preview,
  textOrNumber,
  translated,
  typesOf,
  variantKey,
  variantOf,
} from './schema';

export { defaultFor } from './schema';

export interface FormCtx {
  /** The lesson's language: text fields are written in it. */
  lang: string;
  /** Localizable paths of the edited object ("items.*.text"). */
  text?: string[];
  /** Languages its text is translated into ("Translated into French, Arabic"). */
  langs?: string[];
  /** A problem reported for a path of the edited object ("steps.1"). */
  errorAt?: (path: string) => string | undefined;
}

const has = (k: string): k is MsgKey => k in en;

/** The label of a property: its catalog name, else the name itself (shown as code). */
export function usePropLabel() {
  const { t } = useI18n();
  return (name: string): ReactNode =>
    has(`prop.${name}`) ? t(`prop.${name}` as MsgKey) : <code className="prop-code">{name}</code>;
}

/** The same, as plain text (an option, an accessible name). */
function usePropText() {
  const { t } = useI18n();
  return (name: string): string => (has(`prop.${name}`) ? t(`prop.${name}` as MsgKey) : name);
}

/** A number typed in a box: what is on the way to a number ("-", "1.") stays in the box until it is one. */
export function NumberInput({
  value,
  onChange,
  required,
  ...rest
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    // a new value from outside (another beat, Undo): the box shows it, unless it is what the box already says
    setText((cur) => (numberOf(cur) === value || (cur === '' && value === undefined) ? cur : (value ?? '').toString()));
  }, [value]);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      dir="ltr"
      value={text}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        if (s.trim() === '') {
          if (!required) onChange(undefined);
          return;
        }
        const n = numberOf(s);
        if (n !== undefined) onChange(n);
      }}
      onBlur={() => setText(value === undefined ? '' : String(value))}
    />
  );
}

/** A field's label row: its name and, for an optional field that has a value, a button that empties it. */
function Head({ label, htmlFor, remove }: { label: ReactNode; htmlFor?: string; remove?: ReactNode }) {
  if (label === '' && !remove) return null;
  return (
    <span className="sf-head">
      {label !== '' &&
        (htmlFor ? (
          <label className="sf-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="sf-label">{label}</span>
        ))}
      {remove}
    </span>
  );
}

export function SchemaField({
  schema,
  value,
  onChange,
  path,
  label,
  name,
  required,
  ctx,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  path: Path;
  /** Shown above the control ('' for none: list items, a union's inner value). */
  label: ReactNode;
  /** The control's accessible name when it shows no label ("Item 2"). */
  name?: string;
  required?: boolean;
  ctx: FormCtx;
}) {
  const { t, langName } = useI18n();
  const propText = usePropText();
  const id = useId();
  const errId = `${id}-error`;
  const error = ctx.errorAt?.(path.join('.'));
  const types = typesOf(schema);
  const variants = (schema.anyOf ?? schema.oneOf) as JsonSchema[] | undefined;
  const named = label === '' && name ? { 'aria-label': name } : {};
  // optional and empty: offered, not shown (an empty group or list would not validate)
  if (value === undefined && !required && (types.includes('object') || types.includes('array') || variants))
    return (
      <div className="sf-field sf-absent">
        <span className="sf-label">{label === '' ? name : label}</span>
        <Button variant="quiet" icon="plus" onClick={() => onChange(defaultFor(schema))}>
          {t('form.add')}
        </Button>
      </div>
    );
  const remove = !required && value !== undefined && (
    <button
      type="button"
      className="icon-btn sf-remove"
      aria-label={t('form.removeField')}
      title={t('form.removeField')}
      onClick={() => onChange(undefined)}
    >
      <Icon name="close" size={14} />
    </button>
  );

  if (variants?.length) {
    const k = variantOf(variants, value);
    const names = variants.map((_, j) => {
      const key = variantKey(variants, j);
      if (key.kind === 'const') return key.value;
      if (key.kind === 'key')
        return has(`form.variant.${key.value}`) ? t(`form.variant.${key.value}` as MsgKey) : propText(key.value);
      return has(`form.kind.${key.value}`) ? t(`form.kind.${key.value}` as MsgKey) : key.value;
    });
    return (
      <fieldset className="sf-field sf-union">
        <legend className="sf-head">
          <span className="sf-label">{label === '' ? name : label}</span>
          {remove}
        </legend>
        {variants.length > 1 && (
          <select
            aria-label={t('form.kindOf')}
            value={k}
            onChange={(e) => onChange(defaultFor(variants[Number(e.target.value)]))}
          >
            {variants.map((_, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: variants have no id
              <option key={j} value={j}>
                {names[j]}
              </option>
            ))}
          </select>
        )}
        <SchemaField
          schema={variants[k]!}
          value={value}
          onChange={onChange}
          path={path}
          label=""
          name={t('form.value')}
          required
          ctx={ctx}
        />
      </fieldset>
    );
  }

  if (types.includes('object') && !types.includes('string')) {
    const props = schema.properties as Record<string, JsonSchema> | undefined;
    if (!props) return <RecordField {...{ schema, value, onChange, path, label, name, ctx, remove }} />;
    return (
      <ObjectFields
        schema={schema}
        value={(value ?? {}) as Record<string, unknown>}
        onChange={onChange}
        path={path}
        label={label === '' && name ? name : label}
        ctx={ctx}
        extra={remove}
      />
    );
  }
  if (types.includes('array')) return <ArrayField {...{ schema, value, onChange, path, label, name, ctx, remove }} />;

  const hint =
    translated(path, ctx.text) && ctx.langs?.length
      ? t('form.translated', { langs: ctx.langs.map((l) => langName(l)).join(', ') })
      : '';
  const described = error ? { 'aria-describedby': errId, 'aria-invalid': true } : {};
  const wrap = (control: ReactNode) => (
    <div className={`sf-field${error ? ' has-error' : ''}`}>
      <Head label={label} htmlFor={id} remove={remove} />
      {control}
      {hint && <span className="sf-hint">{hint}</span>}
      {error && (
        <span className="sf-error" id={errId}>
          <Icon name="error" size={16} /> <bdi>{error}</bdi>
        </span>
      )}
    </div>
  );

  if ('const' in schema) return null;
  if (Array.isArray(schema.enum)) {
    const def = schema.default as string | undefined;
    return wrap(
      <select
        id={id}
        {...named}
        {...described}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        {(!required || value === undefined) && (
          <option value="">
            {def !== undefined ? t('form.default', { value: enumText(t, def) }) : t('form.none')}
          </option>
        )}
        {(schema.enum as string[]).map((o) => (
          <option key={o} value={o}>
            {enumText(t, o)}
          </option>
        ))}
      </select>,
    );
  }
  if (types.includes('boolean') && types.length === 1)
    return (
      <div className="sf-field">
        <span className="sf-head">
          <label className="check sf-check">
            <input
              type="checkbox"
              {...named}
              checked={typeof value === 'boolean' ? value : schema.default === true}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span>{label}</span>
          </label>
          {remove}
        </span>
      </div>
    );
  if ((types.includes('number') || types.includes('integer')) && types.length === 1)
    return wrap(
      <NumberInput
        id={id}
        {...named}
        {...described}
        required={!!required}
        value={typeof value === 'number' ? value : undefined}
        onChange={(v) => onChange(v === undefined ? (required ? value : undefined) : v)}
      />,
    );
  if (isAny(schema)) return wrap(<AnyInput id={id} {...named} value={value} onChange={onChange} />);
  // text: an id or a pattern is code; long text gets a box; the lesson's text is written in its language; where
  // a number may stand instead (an answer's value), a number typed stays a number
  const code = typeof schema.pattern === 'string';
  const long = typeof schema.maxLength === 'number' && schema.maxLength > 200;
  const orNumber = types.includes('number') || types.includes('integer');
  const common = {
    id,
    ...named,
    ...described,
    value: value === undefined || value === null ? '' : String(value),
    ...(code || orNumber
      ? { dir: 'ltr' as const, spellCheck: false, className: 'code' }
      : { lang: ctx.lang, dir: 'auto' as const }),
    onChange: (e: { target: { value: string } }) => {
      const s = e.target.value;
      if (s === '' && !required) return onChange(undefined);
      onChange(orNumber ? textOrNumber(s) : s);
    },
  };
  return wrap(long ? <textarea rows={2} {...common} /> : <input {...common} />);
}

/** An enum value named in the interface's language (a colour, a place, a size…), else itself. */
function enumText(t: ReturnType<typeof useI18n>['t'], value: string): string {
  for (const k of [`color.${value}`, `enum.${value}`]) if (has(k)) return t(k as MsgKey);
  return value;
}

/** Any JSON value (a cue's free arguments): a number stays a number, an object or a list is written as JSON. */
function AnyInput({
  value,
  onChange,
  ...rest
}: { value: unknown; onChange: (v: unknown) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange'
>) {
  const shown = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <input
      {...rest}
      className="code"
      dir="ltr"
      spellCheck={false}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const s = text.trim();
        if (s === '') return onChange(undefined);
        try {
          onChange(JSON.parse(s));
        } catch {
          onChange(text);
        }
      }}
    />
  );
}

function ObjectFields({
  schema,
  value,
  onChange,
  path,
  label,
  ctx,
  extra,
  skip = [],
}: {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (v: unknown) => void;
  path: Path;
  label: ReactNode;
  ctx: FormCtx;
  extra?: ReactNode;
  /** Properties shown elsewhere (a question's kind, a node's id). */
  skip?: string[];
}) {
  const propLabel = usePropLabel();
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema.required ?? []) as string[]);
  const fields = Object.entries(props).filter(([k, p]) => !skip.includes(k) && !('const' in p));
  const body = fields.map(([k, p]) => (
    <SchemaField
      key={k}
      schema={p}
      value={value[k]}
      required={required.has(k)}
      path={[...path, k]}
      label={propLabel(k)}
      ctx={ctx}
      onChange={(v) => {
        const next = { ...value };
        if (v === undefined) delete next[k];
        else next[k] = v;
        onChange(next);
      }}
    />
  ));
  if (label === '') return <div className="sf-group">{body}</div>;
  return (
    <fieldset className="sf-field sf-group">
      <legend className="sf-head">
        <span className="sf-label">{label}</span>
        {extra}
      </legend>
      {body}
    </fieldset>
  );
}

/** The form of an object schema (a node's props, a question), keeping the keys it doesn't show. */
export function ObjectForm({
  schema,
  value,
  onChange,
  ctx,
  skip,
}: {
  schema: JsonSchema;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  ctx: FormCtx;
  skip?: string[];
}) {
  return (
    <ObjectFields
      schema={schema}
      value={value}
      onChange={(v) => onChange(v as Record<string, unknown>)}
      path={[]}
      label=""
      ctx={ctx}
      {...(skip ? { skip } : {})}
    />
  );
}

function ArrayField({
  schema,
  value,
  onChange,
  path,
  label,
  name,
  ctx,
  remove,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  path: Path;
  label: ReactNode;
  name?: string;
  ctx: FormCtx;
  remove: ReactNode;
}) {
  const { t, num } = useI18n();
  const list = Array.isArray(value) ? value : [];
  const prefix = schema.prefixItems as JsonSchema[] | undefined;
  const error = ctx.errorAt?.(path.join('.'));
  const item = (schema.items ?? {}) as JsonSchema;
  // items that are groups or lists fold to a line each (an equation's tokens would make a long form otherwise)
  const folds = typesOf(item).includes('object') || typesOf(item).includes('array') || !!(item.anyOf ?? item.oneOf);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (k: number) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const set = (k: number, v: unknown) => onChange(list.map((x, j) => (j === k ? v : x)));
  const legend = (
    <legend className="sf-head">
      <span className="sf-label">{label === '' ? name : label}</span>
      {remove}
    </legend>
  );
  // a pair (a fraction's top and bottom): its places side by side
  if (prefix)
    return (
      <fieldset className="sf-field sf-tuple">
        {legend}
        <div className="sf-tuple-row">
          {prefix.map((p, k) => (
            <SchemaField
              // biome-ignore lint/suspicious/noArrayIndexKey: places of a tuple
              key={k}
              schema={p}
              value={list[k]}
              required
              path={[...path, k]}
              label={num(k + 1)}
              ctx={ctx}
              onChange={(v) => set(k, v)}
            />
          ))}
        </div>
      </fieldset>
    );
  const max = typeof schema.maxItems === 'number' ? schema.maxItems : Number.POSITIVE_INFINITY;
  const min = typeof schema.minItems === 'number' ? schema.minItems : 0;
  const move = (k: number, to: number) => {
    const next = [...list];
    const [x] = next.splice(k, 1);
    next.splice(to, 0, x);
    onChange(next);
  };
  return (
    <fieldset className={`sf-field sf-list${error ? ' has-error' : ''}`}>
      {legend}
      <ol className="sf-items">
        {list.map((x, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: list items have no id
          <li key={k} className="sf-item">
            <span className="sf-n mono">{num(k + 1)}</span>
            <div className="sf-item-body">
              {folds && (
                <button type="button" className="sf-fold" aria-expanded={open.has(k)} onClick={() => toggle(k)}>
                  <Icon name="next" size={14} className="sf-fold-icon" />
                  <span className="visually-hidden">{t('form.itemN', { n: k + 1 })}: </span>
                  <bdi dir="auto">{preview(x) || '…'}</bdi>
                </button>
              )}
              {(!folds || open.has(k)) && (
                <SchemaField
                  schema={item}
                  value={x}
                  required
                  path={[...path, k]}
                  label=""
                  name={t('form.itemN', { n: k + 1 })}
                  ctx={ctx}
                  onChange={(v) => set(k, v)}
                />
              )}
            </div>
            <span className="sf-item-tools">
              <button
                type="button"
                className="icon-btn"
                disabled={k === 0}
                aria-label={t('form.up', { n: k + 1 })}
                onClick={() => move(k, k - 1)}
              >
                <Icon name="up" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={k === list.length - 1}
                aria-label={t('form.down', { n: k + 1 })}
                onClick={() => move(k, k + 1)}
              >
                <Icon name="down" size={14} />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={list.length <= min}
                aria-label={t('form.removeItem', { n: k + 1 })}
                onClick={() => onChange(list.filter((_, j) => j !== k))}
              >
                <Icon name="close" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {list.length < max && (
        <Button
          variant="quiet"
          icon="plus"
          onClick={() => {
            onChange([...list, defaultFor(item)]);
            if (folds) setOpen((cur) => new Set(cur).add(list.length));
          }}
        >
          {t('form.addItem')}
        </Button>
      )}
      {error && (
        <span className="sf-error">
          <Icon name="error" size={16} /> <bdi>{error}</bdi>
        </span>
      )}
    </fieldset>
  );
}

/** Named values ("answers": a → "-7"): a name and its value per row. */
function RecordField({
  schema,
  value,
  onChange,
  path,
  label,
  name,
  ctx,
  remove,
}: {
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  path: Path;
  label: ReactNode;
  name?: string;
  ctx: FormCtx;
  remove: ReactNode;
}) {
  const { t } = useI18n();
  const rec = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const each = (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : {}) as JsonSchema;
  const entries = Object.entries(rec);
  // a name already taken is refused: the box shows the name the entry keeps
  const rename = (input: HTMLInputElement, from: string) => {
    const to = input.value.trim();
    if (!to || to === from || to in rec) {
      input.value = from;
      return;
    }
    onChange(Object.fromEntries(entries.map(([k, v]) => [k === from ? to : k, v])));
  };
  return (
    <fieldset className="sf-field sf-record">
      <legend className="sf-head">
        <span className="sf-label">{label === '' ? name : label}</span>
        {remove}
      </legend>
      {entries.map(([k, v]) => (
        <div key={k} className="sf-record-row">
          <input
            className="code sf-key"
            dir="ltr"
            aria-label={t('form.name')}
            defaultValue={k}
            onBlur={(e) => rename(e.target, k)}
          />
          <div className="sf-item-body">
            <SchemaField
              schema={each}
              value={v}
              required
              path={[...path, k]}
              label=""
              name={t('form.valueOf', { name: k })}
              ctx={ctx}
              onChange={(nv) => onChange({ ...rec, [k]: nv })}
            />
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={t('form.removeEntry', { name: k })}
            onClick={() => onChange(Object.fromEntries(entries.filter(([x]) => x !== k)))}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      <Button
        variant="quiet"
        icon="plus"
        onClick={() => {
          let n = entries.length + 1;
          while (`v${n}` in rec) n++;
          onChange({ ...rec, [`v${n}`]: defaultFor(each) });
        }}
      >
        {t('form.addItem')}
      </Button>
    </fieldset>
  );
}
