// The web app's additions to the studio screens: the quiet status line in the top bar (Your data, warnings, the
// start guide), the example book and backup import on the home screen, and backup and delete on a book's screen.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorText } from '../../../studio/src/client/api';
import { Menu } from '../../../studio/src/client/components/Menu';
import { useConfirm, useToast } from '../../../studio/src/client/components/overlays';
import { SideSheet } from '../../../studio/src/client/components/SideSheet';
import { Button, Icon, Notice } from '../../../studio/src/client/components/ui';
import { useI18n } from '../../../studio/src/client/i18n';
import { setOnboarded } from '../../../studio/src/client/prefs';
import { navigate } from '../../../studio/src/client/router';
import type { Bridge } from '../bridge/client';
import { useW } from './i18n';
import { webApi } from './webApi';

/** Your data, in a side sheet: what is stored where, how much, and how to delete it all. */
function YourData({ open, onClose }: { open: boolean; onClose: () => void }) {
  const w = useW();
  const { t, bytes } = useI18n();
  const confirm = useConfirm();
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDone('');
    setError('');
    webApi
      .storage()
      .then((s) => setSize(s.books))
      .catch(() => setSize(null));
  }, [open]);

  const wipe = async () => {
    // a loss that cannot be undone: the dialog, with keeping everything as the safe choice
    if (!(await confirm({ title: w('privacy.wipeConfirm'), confirm: w('privacy.wipe'), danger: true }))) return;
    setBusy(true);
    try {
      await webApi.reset();
      setOnboarded(false);
      setDone(w('privacy.wiped'));
      setSize(0);
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy(false);
  };

  return (
    <SideSheet open={open} onClose={onClose} title={w('privacy.title')} className="web-data">
      <p>{w('privacy.p1')}</p>
      <p>{w('privacy.p2')}</p>
      <p>{w('privacy.p3')}</p>
      {size !== null && <p className="muted">{w('privacy.stored', { size: bytes(size) })}</p>}
      {done && <Notice tone="good">{done}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="actions">
        <Button variant="danger" icon="close" busy={busy} onClick={() => void wipe()}>
          {w('privacy.wipe')}
        </Button>
        {done && (
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              location.assign(location.href.replace(/[?#].*$/, ''));
            }}
          >
            {t('common.close')}
          </Button>
        )}
      </div>
    </SideSheet>
  );
}

/**
 * The web app's one quiet line in the top bar: "Runs in this browser · Your data". Warnings (storage that may
 * be cleared, a storage error, no offline worker) wait in its status menu instead of filling the screen.
 */
export function WebStatus({ bridge, serviceWorker }: { bridge: Bridge; serviceWorker: boolean }) {
  const w = useW();
  const toast = useToast();
  useSyncExternalStore(bridge.subscribe, () => bridge.storageError);
  const [data, setData] = useState(false);
  const info = bridge.info;
  // notices from outside React (a failed download, a link that needs the offline worker) become toasts
  useEffect(() => {
    const show = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; tone?: 'info' | 'error' }>).detail;
      if (d?.text) toast({ text: d.text, tone: d.tone ?? 'info' });
    };
    window.addEventListener('warqa:notice', show);
    return () => window.removeEventListener('warqa:notice', show);
  }, [toast]);
  const warnings = [
    info && !info.persistent ? w('banner.notPersistent') : '',
    bridge.storageError ? w('banner.storage', { error: bridge.storageError }) : '',
    !serviceWorker ? w('banner.noSw') : '',
  ].filter(Boolean);
  return (
    <div className="web-status">
      <span className="web-dot" aria-hidden="true" />
      <span className="web-runs">{w('status.runs')}</span>
      <span className="web-sep" aria-hidden="true">
        ·
      </span>
      <button type="button" className="link-btn web-data-btn" onClick={() => setData(true)}>
        {w('banner.privacy')}
      </button>
      {info?.fake && (
        <span className="web-chip web-chip-test" title={w('banner.test')}>
          {w('banner.testShort')}
        </span>
      )}
      <Menu
        className={`web-status-menu${warnings.length ? ' has-warnings' : ''}`}
        label={warnings.length ? w('status.menuWarn') : w('status.menu')}
        button={
          <>
            <Icon name={warnings.length ? 'warn' : 'info'} size={18} />
            {warnings.length ? <span className="web-count">{warnings.length}</span> : null}
          </>
        }
        header={
          <div className="web-status-list">
            <p className="web-status-title">{w('banner.label')}</p>
            <p>{w('banner.private')}</p>
            {info?.fake && <p>{w('banner.test')}</p>}
            {warnings.length ? (
              warnings.map((x) => (
                <p key={x} className="web-warning-line">
                  <Icon name="warn" size={16} /> {x}
                </p>
              ))
            ) : (
              <p className="muted">{w('status.ok')}</p>
            )}
          </div>
        }
        items={[
          {
            key: 'guide',
            label: w('banner.guide'),
            onSelect: () => {
              setOnboarded(false);
              navigate('/welcome');
            },
          },
          ...(__WARQA_REPO__ ? [{ key: 'desktop', label: w('banner.desktop'), href: `${__WARQA_REPO__}#readme` }] : []),
        ]}
      />
      <YourData open={data} onClose={() => setData(false)} />
    </div>
  );
}

export function HomeActions() {
  const w = useW();
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'' | 'demo' | 'import'>('');
  const [error, setError] = useState('');

  const example = async () => {
    setBusy('demo');
    setError('');
    try {
      const r = await webApi.demo();
      navigate(`/project/${encodeURIComponent(r.id)}/lesson/ch05`);
    } catch (e) {
      setError(errorText(e, t));
      setBusy('');
    }
  };
  const importZip = async (file: File | undefined) => {
    if (!file) return;
    setBusy('import');
    setError('');
    try {
      const r = await webApi.importZip(file);
      navigate(`/project/${encodeURIComponent(r.id)}`);
    } catch (e) {
      setError(w('home.importFailed', { error: errorText(e, t) }));
      setBusy('');
    }
    if (input.current) input.current.value = '';
  };

  return (
    <>
      <Button icon="play" busy={busy === 'demo'} disabled={!!busy} onClick={() => void example()}>
        {w('home.example')}
      </Button>
      <Button icon="up" busy={busy === 'import'} disabled={!!busy} onClick={() => input.current?.click()}>
        {busy === 'import' ? w('home.importing') : w('home.import')}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        aria-label={w('home.import')}
        data-testid="import-input"
        onChange={(e) => void importZip(e.target.files?.[0])}
      />
      {error && (
        <p className="field-error web-action-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function ProjectActions({ id }: { id: string }) {
  const w = useW();
  const { t } = useI18n();
  const confirm = useConfirm();
  // the backup is at the foot of the book's rail (both versions); deleting a book is the browser's own
  const [busy, setBusy] = useState<'' | 'delete'>('');
  const [error, setError] = useState('');

  const remove = async () => {
    if (
      !(await confirm({
        title: w('project.deleteConfirm'),
        confirm: w('project.deleteYes'),
        cancel: w('project.deleteNo'),
        danger: true,
      }))
    )
      return;
    setBusy('delete');
    setError('');
    try {
      await webApi.remove(id);
      navigate('/');
    } catch (e) {
      setError(errorText(e, t));
      setBusy('');
    }
  };

  return (
    <>
      <Button
        variant="quiet"
        icon="close"
        busy={busy === 'delete'}
        disabled={!!busy}
        title={w('project.deleteHint')}
        aria-label={w('project.deleteHint')}
        onClick={() => void remove()}
      >
        {w('project.delete')}
      </Button>
      {error && (
        <p className="field-error web-action-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
