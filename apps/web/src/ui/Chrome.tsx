// The web app's additions to the studio screens: a slim banner (browser version, privacy, start guide, warnings),
// the example book and backup import on the home screen, and backup and delete on a book's screen.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorText } from '../../../studio/src/client/api';
import { Button, Icon, Notice } from '../../../studio/src/client/components/ui';
import { useI18n } from '../../../studio/src/client/i18n';
import { navigate } from '../../../studio/src/client/router';
import { type Bridge, download } from '../bridge/client';
import { useW } from './i18n';
import { setOnboarded } from './prefs';
import { webApi } from './webApi';

function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const w = useW();
  const { t, bytes } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setDone('');
      setError('');
      webApi
        .storage()
        .then((s) => setSize(s.books))
        .catch(() => setSize(null));
    } else if (!open && d.open) d.close();
  }, [open]);

  const wipe = async () => {
    if (!window.confirm(w('privacy.wipeConfirm'))) return;
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
    <dialog ref={ref} className="web-dialog sheet" aria-labelledby="privacy-title" onClose={onClose}>
      <div className="sheet-head">
        <h2 id="privacy-title">{w('privacy.title')}</h2>
        <Button variant="quiet" icon="x" aria-label={t('common.close')} onClick={onClose} />
      </div>
      <p>{w('privacy.p1')}</p>
      <p>{w('privacy.p2')}</p>
      <p>{w('privacy.p3')}</p>
      {size !== null && <p className="muted">{w('privacy.stored', { size: bytes(size) })}</p>}
      {done && <Notice tone="good">{done}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="actions">
        <Button variant="danger" icon="x" busy={busy} onClick={() => void wipe()}>
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
    </dialog>
  );
}

export function Banner({ bridge, serviceWorker }: { bridge: Bridge; serviceWorker: boolean }) {
  const w = useW();
  useSyncExternalStore(bridge.subscribe, () => bridge.storageError);
  const [privacy, setPrivacy] = useState(false);
  const info = bridge.info;
  return (
    <>
      <div className="web-banner">
        <span className="web-chip">{w('banner.label')}</span>
        <span className="web-private">{w('banner.private')}</span>
        {info?.fake && <span className="web-chip web-chip-test">{w('banner.test')}</span>}
        <span className="web-links">
          <button type="button" className="link-btn" onClick={() => setPrivacy(true)}>
            {w('banner.privacy')}
          </button>
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setOnboarded(false);
              navigate('/welcome');
            }}
          >
            {w('banner.guide')}
          </button>
          {__WARQA_REPO__ && (
            <a href={`${__WARQA_REPO__}#readme`} target="_blank" rel="noreferrer">
              {w('banner.desktop')} <Icon name="external" size={13} />
            </a>
          )}
        </span>
      </div>
      {info && !info.persistent && (
        <div className="web-warning" role="alert">
          <Icon name="warn" /> {w('banner.notPersistent')}
        </div>
      )}
      {bridge.storageError && (
        <div className="web-warning" role="alert">
          <Icon name="warn" /> {w('banner.storage', { error: bridge.storageError })}
        </div>
      )}
      {!serviceWorker && (
        <div className="web-warning web-warning-soft" role="status">
          <Icon name="info" /> {w('banner.noSw')}
        </div>
      )}
      <PrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </>
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
  const [busy, setBusy] = useState<'' | 'backup' | 'delete'>('');
  const [error, setError] = useState('');

  const backup = async () => {
    setBusy('backup');
    setError('');
    try {
      await download(webApi.archiveUrl(id), `${id}.warqa.zip`);
    } catch (e) {
      setError(errorText(e, t));
    }
    setBusy('');
  };
  const remove = async () => {
    if (!window.confirm(w('project.deleteConfirm'))) return;
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
        icon="download"
        busy={busy === 'backup'}
        disabled={!!busy}
        title={w('project.backupHint')}
        onClick={() => void backup()}
      >
        {w('project.backup')}
      </Button>
      <Button
        variant="quiet"
        icon="x"
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
