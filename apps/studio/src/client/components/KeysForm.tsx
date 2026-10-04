// Provider and speech keys: masked (last 4 characters at most), saved on this computer (or, in the web app, in
// this browser) only.
import { useEffect, useRef, useState } from 'react';
import type { KeyInfo } from '../../shared/types';
import { useStatus } from '../App';
import { api, errorText } from '../api';
import { useI18n } from '../i18n';
import { Button, Icon, Loading, Notice, Toast } from './ui';

export function KeysForm() {
  const { t } = useI18n();
  const { status, reload } = useStatus();
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [file, setFile] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    api
      .keys()
      .then((r) => {
        setKeys(r.keys);
        setFile(r.file);
      })
      .catch((e) => setError(errorText(e, tRef.current)));
  }, []);

  if (!keys) return error ? <Notice tone="error">{error}</Notice> : <Loading />;

  const providers = status?.providers ?? [];
  const groups: { id: string; name: string; docs?: string; configured?: boolean; kind?: string; keys: KeyInfo[] }[] =
    [];
  for (const p of providers)
    groups.push({
      id: p.id,
      name: p.name,
      docs: p.docs,
      configured: p.configured,
      kind: p.kind,
      keys: keys.filter((k) => k.usedBy[0] === p.id),
    });
  const speech = keys.filter((k) => k.usedBy[0]?.startsWith('speech:'));
  if (speech.length) groups.push({ id: 'speech', name: t('settings.speech'), keys: speech });
  const rest = keys.filter((k) => !groups.some((g) => g.keys.includes(k)));
  if (rest.length) groups.push({ id: 'other', name: '…', keys: rest });

  const dirty = Object.values(values).some((v) => v.trim()) || removed.size > 0;
  const inBrowser = status?.capabilities?.keyStore === 'browser';
  const stored = keys.filter((k) => k.set && k.source === 'studio');
  const forgetAll = async () => {
    if (!window.confirm(t('cap.forgetConfirm'))) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.saveKeys(Object.fromEntries(stored.map((k) => [k.name, null])));
      setKeys(r.keys);
      setValues({});
      setRemoved(new Set());
      setToast(t('cap.forgotten'));
      await reload();
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    setError('');
    const patch: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) patch[k] = v.trim();
    for (const k of removed) patch[k] = null;
    try {
      const r = await api.saveKeys(patch);
      setKeys(r.keys);
      setValues({});
      setRemoved(new Set());
      setToast(t('settings.keysSaved'));
      await reload();
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };

  return (
    <form
      className="keys"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty && !busy) void save();
      }}
    >
      {inBrowser ? (
        <p className="hint">{t('cap.keys')}</p>
      ) : (
        <p className="hint">
          {t('settings.keysIntro', { file: '\u0000' }).split('\u0000')[0]}
          <code dir="ltr">{file}</code>
          {t('settings.keysIntro', { file: '\u0000' }).split('\u0000')[1]}
        </p>
      )}
      <ul className="key-groups">
        {groups
          .filter((g) => g.keys.length)
          .map((g) => (
            <li key={g.id} className="key-group">
              <div className="key-group-head">
                <span className="key-provider">{g.name}</span>
                {g.configured !== undefined && (
                  <span className={g.configured ? 'good small' : 'muted small'}>
                    {g.configured
                      ? g.kind === 'local'
                        ? t('settings.local')
                        : t('settings.ready')
                      : t('settings.needs', { key: g.keys[0]!.name })}
                  </span>
                )}
                {g.docs && (
                  <a className="small" href={g.docs} target="_blank" rel="noreferrer">
                    {t('settings.getKey')} <Icon name="external" size={13} />
                  </a>
                )}
              </div>
              {g.keys.map((k) => {
                const gone = removed.has(k.name);
                const id = `key-${k.name}`;
                return (
                  <div key={k.name} className="key-row">
                    <label htmlFor={id} className="key-name">
                      <code dir="ltr">{k.name}</code>
                      <span className="key-state" dir="ltr">
                        {gone ? (
                          <span className="warn">{t('settings.keyRemoved')}</span>
                        ) : k.set ? (
                          k.masked
                        ) : (
                          <span className="muted">{t('settings.keyNotSet')}</span>
                        )}
                        {k.set && k.source === 'env' && !gone && (
                          <span className="muted"> · {t('settings.keyFromEnv')}</span>
                        )}
                      </span>
                    </label>
                    <input
                      id={id}
                      type={/_URL$|REGION$|VOICE_ID$/.test(k.name) ? 'text' : 'password'}
                      autoComplete={/_URL$|REGION$|VOICE_ID$/.test(k.name) ? 'off' : 'new-password'}
                      spellCheck={false}
                      dir="ltr"
                      placeholder={/_URL$/.test(k.name) ? 'http://localhost:…' : ''}
                      aria-label={t('settings.keyNew', { name: k.name })}
                      value={values[k.name] ?? ''}
                      onChange={(e) => {
                        setValues((v) => ({ ...v, [k.name]: e.target.value }));
                        setToast('');
                      }}
                    />
                    {k.set && k.source === 'studio' && !gone && (
                      <Button
                        variant="quiet"
                        icon="x"
                        aria-label={t('settings.keyRemove', { name: k.name })}
                        title={t('settings.keyRemove', { name: k.name })}
                        onClick={() => setRemoved((r) => new Set(r).add(k.name))}
                      />
                    )}
                  </div>
                );
              })}
            </li>
          ))}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="actions">
        <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>
          {t('settings.keySave')}
        </Button>
        {inBrowser && !!stored.length && (
          <Button variant="quiet" icon="x" disabled={busy} onClick={() => void forgetAll()}>
            {t('cap.forget')}
          </Button>
        )}
        {toast && <Toast>{toast}</Toast>}
      </div>
    </form>
  );
}
