import './LoginPage.css';
import AuthBackground from './components/AuthBackground';
import AuthControls from './components/AuthControls';
import { useAuthLanguage } from './i18n/useAuthLanguage';

const base = import.meta.env.BASE_URL;
const isotypeDark = `${base}brand/elevant-isotype-dark.png`;
const isotypeLight = `${base}brand/elevant-isotype-light.png`;

function Isotype({ className }) {
  return (
    <>
      <img src={isotypeLight} alt="" className={`${className} elv-logo--light`} />
      <img src={isotypeDark} alt="" className={`${className} elv-logo--dark`} />
    </>
  );
}

export default function AuthVisualLayout({ children }) {
  const { t } = useAuthLanguage();
  const tagline = t('taglineTop');

  return (
    <main className="elv-shell">
      <AuthBackground />

      <header className="elv-topbar">
        <span className="elv-brand" role="img" aria-label={t('brandAlt')}>
          <Isotype className="elv-brand-mark" />
        </span>
        <AuthControls />
      </header>

      <p className="elv-tagline">
        <span className="elv-rule" aria-hidden="true" />
        {tagline.map(line => <span key={line} className="elv-tagline-line">{line}</span>)}
      </p>

      <div className="elv-stage">
        <div className="elv-card">
          <span className="elv-card-mark" role="img" aria-label={t('brandAlt')}>
            <Isotype className="elv-card-logo" />
          </span>
          {children}
        </div>
      </div>

      <p className="elv-motto">
        <span className="elv-rule" aria-hidden="true" />
        {t('taglineBottom')}
      </p>
    </main>
  );
}
