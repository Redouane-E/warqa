// The web app's additions to the studio screens: the quiet status line in the top bar (Your data, warnings, the
// start guide), the example book and backup import on the home screen, and backup and delete on a book's screen.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { errorText, saveFile } from '../../../studio/src/client/api';
import { useJobs } from '../../../studio/src/client/components/JobBoard';
import { Menu } from '../../../studio/src/client/components/Menu';
import { useChoose, useConfirm, useToast } from '../../../studio/src/client/components/overlays';
import { SideSheet } from '../../../studio/src/client/components/SideSheet';
import { Button, Icon, Notice } from '../../../studio/src/client/components/ui';
import { useI18n } from '../../../studio/src/client/i18n';
import { BOOKS_CHANGED, bookTitle } from '../../../studio/src/client/pages/Home';
import { usePlace } from '../../../studio/src/client/place';
import { setOnboarded } from '../../../studio/src/client/prefs';
import { navigate } from '../../../studio/src/client/router';
import type { Bridge } from '../bridge/client';
import { useW } from './i18n';
import { checkSpace, isLow, type Space, useSpace, WARN_SHARE } from './storage';
import { webApi } from './webApi';

/** A size inside a sentence: kept left to right ("460 MB") in an Arabic one (an isolate, written as escapes). */
const ltr = (s: string) => `\u2066${s}\u2069`;

/** Opens Your data from anywhere (the storage banner's buttons, the phone's menu). */
export const openYourData = () => window.dispatchEvent(new Event('warqa:your-data'));

/** "Your data" in the interface's language (the phone's menu item). */
export function YourDataLabel() {
  const w = useW();
  return <>{w('banner.privacy')}</>;
}

/** The space this browser uses: a row with the amount, a meter (ink up to the warning line), and when low what to do. */
function SpaceCard({ space, actions }: { space: Space; actions?: boolean }) {
  const w = useW();
  const { bytes, num } = useI18n();
  const share = Math.min(1, space.usage / space.quota);
  const p = Math.round(share * 100);
  const low = isLow(space);
  return (
    <section
      className={`space-card${low ? ' is-low' : ''}`}
      aria-labelledby={actions ? 'space-title-b' : 'space-title'}
    >
      <h3 id={actions ? 'space-title-b' : 'space-title'} className="space-title">
        {low && <Icon name="warn" size={18} />}
        {low ? w('space.title') : w('space.row')}
      </h3>
      <p className="space-row">
        {low && <span>{w('space.row')}</span>}
        <span className="mono">
          {w('space.amount', { used: ltr(bytes(space.usage)), quota: ltr(bytes(space.quota)) })}
        </span>
      </p>
      <div className="space-meter" role="img" aria-label={w('space.meter', { p: num(p) })}>
        <span className="space-fill" style={{ inlineSize: `${Math.min(share, WARN_SHARE) * 100}%` }} />
        {share > WARN_SHARE && <span className="space-over" style={{ inlineSize: `${(share - WARN_SHARE) * 100}%` }} />}
      </div>
      {low && (
        <p className="space-body">{w('space.body', { free: ltr(bytes(Math.max(0, space.quota - space.usage))) })}</p>
      )}
      {low && actions && (
        <div className="space-actions">
          <Button variant="primary" icon="download" onClick={openYourData}>
            {w('space.backup')}
          </Button>
          <Button variant="quiet" onClick={openYourData}>
            {w('space.see')}
          </Button>
        </div>
      )}
    </section>
  );
}

const SPACE_HIDDEN = 'warqa-web:space-hidden';

/** Under the top bar while the browser's storage is almost full (hidden for the session if you close it). */
export function StorageBanner() {
  const { t } = useI18n();
  const space = useSpace();
  const jobs = useJobs();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(SPACE_HIDDEN) === '1';
    } catch {
      return false;
    }
  });
  // measured again when work ends (a build, an export: the books grow)
  const pid = jobs.current?.projectId;
  useEffect(() => (pid ? jobs.onEnd(pid, () => void checkSpace()) : undefined), [pid, jobs]);
  return (
    <div className="space-host" role="status">
      {isLow(space) && !hidden && (
        <div className="space-banner">
          <SpaceCard space={space} actions />
          <button
            type="button"
            className="icon-btn space-hide"
            aria-label={t('common.close')}
            onClick={() => {
              setHidden(true);
              try {
                sessionStorage.setItem(SPACE_HIDDEN, '1');
              } catch {
                /* storage unavailable: hidden until the page reloads */
              }
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

type BookSize = NonNullable<Awaited<ReturnType<typeof webApi.storage>>['list']>[number];

/** Your data, in a side sheet: what is stored where, how much, each book's size, and how to delete it all. */
function YourData({ open, onClose }: { open: boolean; onClose: () => void }) {
  const w = useW();
  const { t, bytes, lang } = useI18n();
  const confirm = useConfirm();
  const toast = useToast();
  const space = useSpace();
  const place = usePlace();
  const [size, setSize] = useState<number | null>(null);
  const [list, setList] = useState<BookSize[]>([]);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState('');
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const load = () =>
    webApi
      .storage(true)
      .then((s) => {
        setSize(s.books);
        setList(s.list ?? []);
      })
      .catch(() => {
        setSize(null);
        setList([]);
      });
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each opening
  useEffect(() => {
    if (!open) return;
    setDone('');
    setError('');
    void load();
    void checkSpace();
  }, [open]);

  const backup = async (b: BookSize) => {
    setRowBusy(`save:${b.id}`);
    try {
      await saveFile(webApi.archiveUrl(b.id), `${b.id}.warqa.zip`);
    } catch (e) {
      toast({ text: errorText(e, t), tone: 'error' });
    }
    setRowBusy('');
  };
  const remove = async (b: BookSize) => {
    const title = bookTitle(b.title, lang, b.defaultLang);
    if (
      !(await confirm({
        title: w('space.deleteConfirm', { title }),
        body: w('space.deleteBody'),
        confirm: w('project.deleteYes'),
        cancel: w('project.deleteNo'),
        danger: true,
      }))
    )
      return;
    setRowBusy(`del:${b.id}`);
    try {
      await webApi.remove(b.id);
      toast({ text: w('space.deleted', { title }) });
      // the screens that showed it follow: its own page goes home, Your books loads its list again
      if (place.book?.id === b.id) navigate('/');
      window.dispatchEvent(new Event(BOOKS_CHANGED));
      await load();
      await checkSpace();
    } catch (e) {
      toast({ text: errorText(e, t), tone: 'error' });
    }
    setRowBusy('');
  };

  const wipe = async () => {
    // a loss that cannot be undone: the dialog, with keeping everything as the safe choice
    if (!(await confirm({ title: w('privacy.wipeConfirm'), confirm: w('privacy.wipe'), danger: true }))) return;
    setBusy(true);
    try {
      await webApi.reset();
      setOnboarded(false);
      setDone(w('privacy.wiped'));
      setSize(0);
      setList([]);
      void checkSpace();
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
      {space && <SpaceCard space={space} />}
      {size !== null && <p className="muted">{w('privacy.stored', { size: ltr(bytes(size)) })}</p>}
      {list.length > 0 && (
        <section className="space-books" aria-labelledby="space-books-title">
          <h3 id="space-books-title" className="space-books-title">
            {w('space.books')}
          </h3>
          <ul>
            {list.map((b) => {
              const title = bookTitle(b.title, lang, b.defaultLang);
              return (
                <li key={b.id}>
                  <span className="space-book" dir="auto">
                    {title}
                  </span>
                  <bdi className="mono muted space-book-size" dir="ltr">
                    {bytes(b.bytes)}
                  </bdi>
                  <span className="space-book-acts">
                    <Button
                      variant="quiet"
                      icon="download"
                      busy={rowBusy === `save:${b.id}`}
                      disabled={!!rowBusy}
                      aria-label={`${w('space.backup')}: ${title}`}
                      onClick={() => void backup(b)}
                    >
                      {w('space.backupShort')}
                    </Button>
                    <Button
                      variant="quiet"
                      icon="close"
                      busy={rowBusy === `del:${b.id}`}
                      disabled={!!rowBusy}
                      aria-label={`${w('project.delete')}: ${title}`}
                      onClick={() => void remove(b)}
                    >
                      {w('project.delete')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
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
  const space = useSpace();
  // the storage banner opens Your data
  useEffect(() => {
    const open = () => setData(true);
    window.addEventListener('warqa:your-data', open);
    return () => window.removeEventListener('warqa:your-data', open);
  }, []);
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
    isLow(space) ? w('space.title') : '',
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
  const { t, lang, locale } = useI18n();
  const choose = useChoose();
  const toast = useToast();
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
      let r = await webApi.importZip(file, 'ask');
      if ('exists' in r) {
        // the book is here already: replace it (its changes since the backup are lost), keep both, or neither (Esc)
        const x = r.exists;
        const title = bookTitle(x.title, lang, x.defaultLang);
        // the year too when it is not this one ("since 5 Oct 2025")
        const made = x.exported ? new Date(x.exported) : null;
        const date = made
          ? new Intl.DateTimeFormat(locale, {
              day: 'numeric',
              month: 'short',
              ...(made.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
            }).format(made)
          : '';
        const c = await choose({
          title: w('import.exists', { title }),
          body: date ? w('import.existsBody', { date }) : w('import.existsBodyNoDate'),
          confirm: w('import.replace'),
          cancel: w('import.keepBoth'),
          safeIsAction: true,
        });
        if (c === null) {
          setBusy('');
          if (input.current) input.current.value = '';
          return;
        }
        r = await webApi.importZip(file, c === 'confirm' ? 'replace' : 'copy');
        if ('exists' in r) throw new Error(w('import.exists', { title }));
        if (c === 'confirm') toast({ text: w('import.replaced', { title }) });
      }
      void checkSpace();
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
