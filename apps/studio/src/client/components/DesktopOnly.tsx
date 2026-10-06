// What this host cannot do, said where it would be done (apps/AGENTS.md: "explain themselves when unavailable,
// never fail silently"): a dashed chip, the reason (which the disabled control points at), and where to get the
// desktop version when the host knows.
import { useExtras } from '../extras';
import { useI18n } from '../i18n';
import { Icon } from './ui';

/** `label`: what is missing, when it is not the desktop version (a desktop without Playwright's browser). */
export function DesktopOnlyChip({ label }: { label?: string } = {}) {
  const { t } = useI18n();
  return <span className="chip-desk">{label ?? t('cap.desktopChip')}</span>;
}

/** `chip`: what is missing, when it is not the desktop version (then no link to the desktop version). */
export function DesktopOnly({ id, reason, chip }: { id: string; reason: string; chip?: string }) {
  const { t } = useI18n();
  const { desktopUrl } = useExtras();
  return (
    <div className="desk-only">
      <DesktopOnlyChip {...(chip ? { label: chip } : {})} />
      <p id={id} className="desk-reason">
        {reason}
      </p>
      {desktopUrl && !chip && (
        <a className="desk-link" href={desktopUrl} target="_blank" rel="noreferrer">
          <span>{t('cap.getDesktop')}</span>
          <Icon name="open" size={16} />
        </a>
      )}
    </div>
  );
}
