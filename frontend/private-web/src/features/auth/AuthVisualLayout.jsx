import './LoginPage.css';
import AirportShowcase from './components/AirportShowcase';
import AuthBackground from './components/AuthBackground';
import AuthControls from './components/AuthControls';
import LoginIntro from './components/LoginIntro';
import { useAuthLanguage } from './i18n/useAuthLanguage';

const base = import.meta.env.BASE_URL;
const markLight = `${base}brand/elevant-mark-light.png`;
const markDark = `${base}brand/elevant-mark-dark.png`;

function Isotype({ className }) {
  return (
    <>
      <img src={markLight} alt="" className={`${className} elv-logo--light`} decoding="async" />
      <img src={markDark} alt="" className={`${className} elv-logo--dark`} decoding="async" />
    </>
  );
}

export default function AuthVisualLayout({ children, intro = false }) {
  const { t } = useAuthLanguage();

  return (
    <main className="elv-shell">
      <AuthBackground />

      <div className="elv-stage">
        <div className="elv-card">
          <div className="elv-glass" aria-hidden="true" />
          <div className="elv-panel">
            <AuthControls />
            <span className="elv-brand" role="img" aria-label={t('brandAlt')}>
              <Isotype className="elv-brand-mark" />
            </span>
            {children}
          </div>
          <AirportShowcase />
        </div>
      </div>

      {intro && <LoginIntro marks={<Isotype className="elv-intro-logo" />} />}
    </main>
  );
}
