import './LoginPage.css';

const navyLogo = `${import.meta.env.BASE_URL}brand/elevant-official-navy.png`;
const lightLogo = `${import.meta.env.BASE_URL}brand/elevant-official-light.png`;

export default function AuthVisualLayout({ children }) {
  return (
    <main className="elv-shell">
      <aside className="elv-aside" aria-label="Identidad de ELEVANT">
        <div className="elv-aside-top">
          <span className="elv-aside-rule" aria-hidden="true" />
          <span>AVIAM · Acceso interno</span>
        </div>

        <div className="elv-brand-stage">
          <img
            src={navyLogo}
            alt="ELEVANT — Elevando la gestión de operaciones en tierra"
            className="elv-brand-image-dark"
          />
        </div>

        <div className="elv-aside-bottom">
          <p>Una vista clara para coordinar cada operación en tierra.</p>
          <span>Plataforma de operaciones AVIAM</span>
        </div>
      </aside>

      <div className="elv-right">
        <div className="elv-right-inner">
          <div className="elv-mobile-brand">
            <img
              src={lightLogo}
              alt="ELEVANT — Elevando la gestión de operaciones en tierra"
            />
          </div>
          <div className="elv-panel">{children}</div>
          <div className="elv-footer-meta">© 2026 ELEVANT · AVIAM</div>
        </div>
      </div>
    </main>
  );
}
