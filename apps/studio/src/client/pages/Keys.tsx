import { KeysForm } from '../components/KeysForm';
import { useI18n } from '../i18n';

export function KeysPage() {
  const { t } = useI18n();
  return (
    <div className="page page-keys">
      <header className="page-head">
        <div>
          <h1 className="display">{t('keys.title')}</h1>
          <p className="lede">{t('keys.lede')}</p>
        </div>
      </header>
      <section className="sheet">
        <KeysForm />
      </section>
    </div>
  );
}
