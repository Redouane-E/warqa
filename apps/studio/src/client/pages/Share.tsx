// ⑥ Share (redesign 4f, the Share board): the book as a learner gets it (the exported home, in a frame that does
// nothing), what it holds, Open the book (a new tab), the offline zip and its size, and when it was exported (Export
// again turns into the one ink button when the lessons changed since). Then other ways to share: SCORM for school
// platforms, flashcards, videos (desktop: a browser and ffmpeg make them), and a backup of the whole book.
import { langInfo, t as playerT } from '@warqa/i18n';
import { useState } from 'react';
import type { JobType, ProjectDetail, StatusInfo } from '../../shared/types';
import { api, errorText, saveFile } from '../api';
import { withBase } from '../base';
import { DesktopOnlyChip } from '../components/DesktopOnly';
import { useToast } from '../components/overlays';
import { Button, Icon, Notice } from '../components/ui';
import { useExtras } from '../extras';
import { useI18n } from '../i18n';
import { Link } from '../router';
import { bookTitle } from './Home';

type Run = (type: JobType, args?: Record<string, unknown>) => Promise<void>;

/**
 * The book's home as a learner sees it, drawn from the book's data in its first language with the player's own
 * words. Not the exported page itself: no page of a book runs inside the studio (an imported book could carry
 * scripts).
 */
function BookPreview({ p, lang, title }: { p: ProjectDetail; lang: string; title: string }) {
  const n = p.lessons.length;
  const voiced = p.lessons.some((l) => l.hasAudio[lang]);
  const info = langInfo(lang);
  return (
    <div className="book-preview" lang={lang} dir={info.dir} aria-hidden="true">
      <div className="bp-top">
        <span className="bp-mark" />
        <span className="bp-made">{playerT(lang, 'book.madeWith')}</span>
      </div>
      <p className="bp-kind">{playerT(lang, 'book.kind')}</p>
      <p className="bp-title">{title}</p>
      <p className="bp-meta">
        {playerT(lang, 'book.chapters', { n })}
        {voiced ? ` · ${playerT(lang, 'book.withSound')}` : ''}
      </p>
      <span className="bp-start">{playerT(lang, 'book.start', { n: 1 })}</span>
      <ol className="bp-contents">
        {p.lessons.slice(0, 4).map((l, i) => (
          <li key={l.id}>
            <span className="bp-n">{i + 1}</span>
            <span className="bp-name">{l.title[lang] ?? l.title[l.lang] ?? l.id}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** "Last exported today at 14:32", or "Last exported 3 days ago". */
function useExportedAt() {
  const { t, locale, ago } = useI18n();
  return (at: number) =>
    new Date().toDateString() === new Date(at).toDateString()
      ? t('share.lastToday', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(at) })
      : t('export.last', { when: ago(at) });
}

export function ShareStep({
  p,
  status,
  run,
  live,
}: {
  p: ProjectDetail;
  status: StatusInfo | null;
  run: Run;
  live: Set<JobType>;
  reload: () => Promise<void>;
}) {
  const i18n = useI18n();
  const { t, bytes, langName, lang: ui } = i18n;
  const toast = useToast();
  const { desktopUrl } = useExtras();
  const exportedAt = useExportedAt();
  const book = encodeURIComponent(p.id);
  const caps = status?.capabilities;
  const info = p.exportInfo;
  const first = p.langs.includes(p.book.defaultLang ?? '') ? p.book.defaultLang! : (p.langs[0] ?? ui);
  const [cardsLang, setCardsLang] = useState(first);
  const [videoLang, setVideoLang] = useState(first);
  const [busy, setBusy] = useState('');
  const list = (items: string[]) => {
    try {
      return new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  };

  if (!p.lessons.length)
    return (
      <section className="sheet make-sheet" aria-labelledby="sh-title">
        <div className="make-head">
          <h2 id="sh-title" className="card-title">
            {t('step.share')}
          </h2>
        </div>
        <div className="make-empty">
          <h3 className="block-title">{t('share.emptyTitle')}</h3>
          <p className="hint">{t('share.emptyBody')}</p>
          <Link className="btn btn-primary" to={`/project/${book}?step=make`}>
            <span>{t('check.toMake')}</span>
            <Icon name="next" className="flip-rtl" />
          </Link>
        </div>
      </section>
    );

  const questions = p.lessons.reduce((a, l) => a + (l.questions ?? 0), 0);
  const voiced = p.lessons.every((l) => p.book.langs.every((g) => !l.langs.includes(g) || l.hasAudio[g]));
  const facts = (voiced ? 'share.facts' : 'share.factsNoVoice') as 'share.facts';
  const factsText = t(facts, {
    chapters: t('common.chapters', { n: p.lessons.length }),
    langs: list(p.book.langs.map((l) => langName(l))),
    questions: t('common.questions', { n: questions }),
  });
  const exporting = live.has('export');
  const stale = info.exported && info.stale;
  const saving = async (key: string, url: string, name: string) => {
    setBusy(key);
    try {
      await saveFile(url, name);
    } catch (e) {
      toast({ text: errorText(e, t), tone: 'error' });
    }
    setBusy('');
  };
  const videoOk = caps?.playwright !== false && !caps?.jobsUnavailable.includes('video');
  // a desktop without Playwright's browser is told to install it, not to get the desktop version
  const noPlaywright = caps?.platform === 'desktop' && caps.playwright === false;
  const someDesktop = caps?.platform === 'browser' && !videoOk;
  const videos = info.videos ?? [];
  const title = bookTitle(p.title, first, p.defaultLang);

  return (
    <div className="share-step">
      <section className="sheet share-hero" aria-labelledby="sh-title">
        <figure className="share-preview">
          {info.exported ? (
            <BookPreview p={p} lang={first} title={title} />
          ) : (
            <div className="share-cover" lang={first} dir={langInfo(first).dir}>
              <span className="share-cover-mark" aria-hidden="true" />
              <bdi className="share-cover-title">{title}</bdi>
              <span className="share-cover-bar" aria-hidden="true" />
            </div>
          )}
          <figcaption>{t('share.preview', { lang: langName(first) })}</figcaption>
        </figure>
        <div className="share-text">
          <div className="share-head">
            {info.exported && (
              <span className="share-chip">
                <Icon name="check" size={16} /> {t('share.exported')}
              </span>
            )}
            <h2 id="sh-title" className="share-title">
              {info.exported ? t('share.ready') : t('share.title')}
            </h2>
            <p className="share-facts">{factsText}</p>
          </div>
          {stale && <Notice>{t('share.stale')}</Notice>}
          <div className="share-actions">
            {info.exported ? (
              <>
                <a
                  className={`btn ${stale ? 'btn-default' : 'btn-primary'} btn-big`}
                  href={withBase(`/books/${book}/`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="open" />
                  <span>{t('export.open')}</span>
                </a>
                {info.zip && (
                  <a className="btn btn-default btn-big" href={withBase(`/api/projects/${book}/download`)} download>
                    <Icon name="download" />
                    <span>{t('export.download')}</span>
                    {info.zipBytes !== undefined && <span className="mono muted small">{bytes(info.zipBytes)}</span>}
                  </a>
                )}
              </>
            ) : (
              <Button
                variant="primary"
                icon="play"
                busy={exporting}
                disabled={exporting}
                onClick={() => void run('export')}
              >
                {t('export.run')}
              </Button>
            )}
          </div>
          <p className="share-note">
            <Icon name="info" size={20} />
            <span>{info.exported ? t('share.offline') : t('share.exportNote')}</span>
          </p>
          {info.exported && info.at && (
            <div className="share-foot">
              <span>{exportedAt(info.at)}</span>
              <span aria-hidden="true">·</span>
              <Button
                variant={stale ? 'primary' : 'quiet'}
                icon="regenerate"
                busy={exporting}
                disabled={exporting}
                onClick={() => void run('export')}
              >
                {t('export.again')}
              </Button>
            </div>
          )}
        </div>
      </section>

      <section className="share-other" aria-labelledby="sh-other">
        <div className="share-other-head">
          <h2 id="sh-other" className="check-card-title">
            {t('share.other')}
          </h2>
          {someDesktop && desktopUrl && (
            <a className="desk-link" href={desktopUrl} target="_blank" rel="noreferrer">
              <span>{t('cap.getDesktop')}</span>
              <Icon name="open" size={16} />
            </a>
          )}
        </div>
        <ul className="share-cards">
          <li className="share-card">
            <span className="share-card-icon" aria-hidden="true">
              <Icon name="book" size={22} />
            </span>
            <h3>{t('share.scorm.title')}</h3>
            <p className="mono muted small">{t('share.scorm.format')}</p>
            <p className="share-card-text">{t('share.scorm.body')}</p>
            <div className="share-card-act">
              {info.scorm ? (
                <>
                  <Button
                    icon="download"
                    busy={busy === 'scorm'}
                    onClick={() => void saving('scorm', api.scormUrl(p.id), `${p.id}-scorm.zip`)}
                  >
                    {t('share.scorm.download')}
                  </Button>
                  <span className="mono muted small">{bytes(info.scorm.bytes)}</span>
                </>
              ) : (
                <Button
                  icon="play"
                  busy={live.has('scorm')}
                  disabled={live.has('scorm')}
                  onClick={() => void run('scorm')}
                >
                  {t('share.scorm.run')}
                </Button>
              )}
              {info.scorm && (
                // after the lessons change, the package is made again from them
                <Button
                  variant="quiet"
                  icon="regenerate"
                  busy={live.has('scorm')}
                  disabled={live.has('scorm')}
                  onClick={() => void run('scorm')}
                >
                  {t('share.scorm.again')}
                </Button>
              )}
            </div>
          </li>
          <li className="share-card">
            <span className="share-card-icon" aria-hidden="true">
              <Icon name="transcript" size={22} />
            </span>
            <h3>{t('share.cards.title')}</h3>
            <p className="mono muted small">{t('share.cards.format')}</p>
            <p className="share-card-text">{t('share.cards.body')}</p>
            {questions ? (
              <div className="share-card-act">
                <label className="share-lang">
                  <span className="visually-hidden">{t('share.cards.lang')}</span>
                  <select value={cardsLang} onChange={(e) => setCardsLang(e.target.value)}>
                    {p.book.langs.map((l) => (
                      <option key={l} value={l} lang={l}>
                        {langInfo(l).name}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  icon="download"
                  busy={busy === 'anki'}
                  onClick={() =>
                    void saving(
                      'anki',
                      api.flashcardsUrl(p.id, cardsLang, 'anki'),
                      `${p.id}-flashcards-${cardsLang}.txt`,
                    )
                  }
                >
                  {t('share.cards.anki')}
                </Button>
                <Button
                  variant="quiet"
                  busy={busy === 'csv'}
                  onClick={() =>
                    void saving('csv', api.flashcardsUrl(p.id, cardsLang, 'csv'), `${p.id}-flashcards-${cardsLang}.csv`)
                  }
                >
                  {t('share.cards.csv')}
                </Button>
              </div>
            ) : (
              <p className="muted small">{t('share.cards.none')}</p>
            )}
          </li>
          <li className="share-card">
            <span className="share-card-icon" aria-hidden="true">
              <Icon name="play" size={22} />
            </span>
            <h3>{t('share.video.title')}</h3>
            <p className="mono muted small" dir="auto">
              {t('share.video.format')}
            </p>
            <p className="share-card-text">{t('share.video.body')}</p>
            <div className="share-card-act">
              {noPlaywright ? (
                <>
                  <DesktopOnlyChip label={t('cap.needsPlaywright')} />
                  <span className="muted small">{t('check.needsPlaywright')}</span>
                </>
              ) : !videoOk ? (
                <DesktopOnlyChip />
              ) : caps?.ffmpeg === false ? (
                <>
                  <span className="chip-desk">{t('share.video.ffmpeg')}</span>
                  <span className="muted small">{t('share.video.ffmpegHint')}</span>
                </>
              ) : (
                <>
                  <label className="share-lang">
                    <span className="visually-hidden">{t('share.cards.lang')}</span>
                    <select value={videoLang} onChange={(e) => setVideoLang(e.target.value)}>
                      {p.book.langs.map((l) => (
                        <option key={l} value={l} lang={l}>
                          {langInfo(l).name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    icon="play"
                    busy={live.has('video')}
                    disabled={live.has('video')}
                    onClick={() => void run('video', { lang: videoLang })}
                  >
                    {t('share.video.run')}
                  </Button>
                </>
              )}
            </div>
            {videoOk && videos.length > 0 && (
              <ul className="share-files">
                {videos.map((v) => (
                  <li key={`${v.lesson}.${v.lang}`}>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        void saving(
                          `v-${v.lesson}-${v.lang}`,
                          api.videoUrl(p.id, v.lesson, v.lang),
                          `${p.id}-${v.lesson}-${v.lang}.mp4`,
                        )
                      }
                    >
                      <bdi>{p.lessons.find((l) => l.id === v.lesson)?.title[v.lang] ?? v.lesson}</bdi> ·{' '}
                      {langInfo(v.lang).name}
                    </button>{' '}
                    <span className="mono muted small">{bytes(v.bytes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
          <li className="share-card">
            <span className="share-card-icon" aria-hidden="true">
              <Icon name="file" size={22} />
            </span>
            <h3>{t('share.backup.title')}</h3>
            <p className="mono muted small">{t('share.backup.format')}</p>
            <p className="share-card-text">
              {caps?.platform === 'browser' ? t('share.backup.body') : t('share.backup.bodyDesktop')}
            </p>
            <div className="share-card-act">
              <Button
                icon="download"
                busy={busy === 'backup'}
                onClick={() => void saving('backup', api.archiveUrl(p.id), `${p.id}.warqa.zip`)}
              >
                {t('share.backup.run')}
              </Button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
