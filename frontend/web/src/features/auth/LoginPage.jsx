import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './LoginPage.css';

// Public asset resolved through Vite's base URL so it works in dev and production builds.
const elevantLogo = `${import.meta.env.BASE_URL}brand/elevant-logo.png`;

const BLOBS = [
  { key: 'b1', style: { width: 620, height: 620, left: '-14%', top: '-18%', background: 'radial-gradient(circle, rgba(60,124,224,0.42), rgba(60,124,224,0) 68%)', animationName: 'elv-float16', animationDuration: '16s' } },
  { key: 'b2', style: { width: 520, height: 520, right: '-12%', bottom: '-10%', background: 'radial-gradient(circle, rgba(255,106,31,0.20), rgba(255,106,31,0) 66%)', animationName: 'elv-float22', animationDuration: '22s' } },
  { key: 'b3', style: { width: 460, height: 460, left: '38%', top: '32%', background: 'radial-gradient(circle, rgba(24,80,180,0.45), rgba(24,80,180,0) 70%)', animationName: 'elv-float19', animationDuration: '19s' } },
];

const WINGS = [
  { key: 'w1', width: 780, height: 190, left: '-8%', top: '16%', opacity: 0.10, duration: 26 },
  { key: 'w2', width: 640, height: 160, left: '18%', top: '42%', opacity: 0.075, duration: 32 },
  { key: 'w3', width: 520, height: 130, left: '4%', top: '66%', opacity: 0.055, duration: 29 },
];

const PARTICLES = Array.from({ length: 22 }, (_, i) => {
  const seed = (i * 37) % 100;
  return {
    key: 'p' + i,
    width: i % 5 === 0 ? 3 : 2,
    height: i % 5 === 0 ? 3 : 2,
    left: `${((seed * 1.01) % 96) + 2}%`,
    top: `${((i * 53) % 92) + 4}%`,
    background: i % 7 === 0 ? 'rgba(255,138,74,0.75)' : 'rgba(255,255,255,0.7)',
    duration: 14 + (i % 7) * 3,
    delay: i * 0.6,
  };
});

function Ambient() {
  return (
    <div className="elv-ambient" aria-hidden="true">
      {BLOBS.map(b => (
        <div key={b.key} className="elv-blob" style={b.style} />
      ))}
      {WINGS.map(w => (
        <div
          key={w.key}
          className="elv-wing"
          style={{
            width: w.width,
            height: w.height,
            left: w.left,
            top: w.top,
            background: `linear-gradient(105deg, rgba(255,255,255,${w.opacity + 0.06}) 0%, rgba(255,255,255,${w.opacity * 0.35}) 46%, rgba(255,255,255,0) 100%)`,
            animationDuration: `${w.duration}s`,
          }}
        />
      ))}
      {PARTICLES.map(p => (
        <div
          key={p.key}
          className="elv-particle"
          style={{
            width: p.width,
            height: p.height,
            left: p.left,
            top: p.top,
            background: p.background,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
      <div className="elv-sheen" />
    </div>
  );
}

function EmailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#8C9AB4" strokeWidth="1.6" className="elv-input-icon">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#8C9AB4" strokeWidth="1.6" className="elv-input-icon">
      <rect x="4" y="10.5" width="16" height="10" rx="2.5" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </svg>
  );
}

function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="18" height="18">
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="18" height="18">
      <path d="M4 4.5 20 20.5" />
      <path d="M9.9 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.4 4.1M6.4 8A17 17 0 0 0 2.5 12s3.5 6 9.5 6a9.4 9.4 0 0 0 3.3-.6" />
      <path d="M10 10a3 3 0 0 0 4.1 4.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="m5 12.5 4.4 4.5L19 7" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" opacity="0.9">
      <path d="M4 12h14m-5.5-5.5L18.5 12l-6 5.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="#2B65C4" strokeWidth="1.6" width="15" height="15" style={{ flex: 'none' }}>
      <path d="M12 3.2 5 6v5.4c0 4.3 2.9 8 7 9.4 4.1-1.4 7-5.1 7-9.4V6l-7-2.8Z" />
      <path d="m9.2 12.1 2 2 3.6-3.9" />
    </svg>
  );
}

function Logo({ bright = false }) {
  return (
    <div className={`elv-logo-crop${bright ? ' elv-logo-crop--bright' : ''}`}>
      <img src={elevantLogo} alt="ELEVANT" className="elv-logo-img" />
    </div>
  );
}

export default function LoginPage({ onSubmit = async () => {} }) {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState('idle'); // 'idle' | 'busy' | 'done'
  const [ripple, setRipple] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const submitRef = useRef(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const busy = status !== 'idle';

  const handleSubmit = e => {
    e.preventDefault();
    if (busy) return;

    const rect = submitRef.current.getBoundingClientRect();
    setRipple({ id: Date.now(), x: rect.width / 2, y: rect.height / 2 });
    setStatus('busy');
    setErrorMessage('');

    const formData = new FormData(e.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    Promise.resolve(onSubmit({ email, password, remember }))
      .then(() => {
        setStatus('done');
        timers.current.push(setTimeout(() => setStatus('idle'), 1200));
      })
      .catch(error => {
        setStatus('idle');
        setRipple(null);
        setErrorMessage(error?.message ?? 'No fue posible iniciar sesión.');
      });
  };

  const submitLabel = useMemo(() => {
    if (status === 'busy') return 'Autenticando';
    if (status === 'done') return 'Acceso concedido';
    return 'Iniciar sesión';
  }, [status]);

  return (
    <div className="elv-shell">
      <div className="elv-aside">
        <Ambient />

        <div className="elv-aside-top">
          <Logo bright />
          <div className="elv-divider-v" />
          <div className="elv-eyebrow-top">Elevando la Gestión de Operaciones en Tierra</div>
        </div>

        <div className="elv-hero">
          <div className="elv-eyebrow">Operaciones de Handling en Tierra</div>
          <h1 className="elv-headline">
            Precisión en tierra,<br />en cada rotación.
          </h1>
          <p className="elv-subhead">
            Una plataforma operativa unificada para la coordinación de rotaciones, contratos, personal y control financiero en cada estación.
          </p>
        </div>

        <div className="elv-stats">
          <div className="elv-stat">
            <div className="elv-stat-value">99.98%</div>
            <div className="elv-stat-label">Disponibilidad de la plataforma</div>
          </div>
          <div className="elv-stat">
            <div className="elv-stat-value">24 / 7</div>
            <div className="elv-stat-label">Cobertura OCC</div>
          </div>
          <div className="elv-stat">
            <div className="elv-stat-value">ISO 27001</div>
            <div className="elv-stat-label">Controles certificados</div>
          </div>
        </div>
      </div>

      <div className="elv-right">
        <div className="elv-glow-a" aria-hidden="true" />
        <div className="elv-glow-b" aria-hidden="true" />

        <div className="elv-panel">
          <div className="elv-card">
            <div className="elv-card-header">
              <Logo />
              <div className="elv-brand-block">
                <div className="elv-brand">ELEVANT</div>
                <div className="elv-brand-sub">Plataforma de Operaciones de Handling en Tierra</div>
              </div>
            </div>

            <div className="elv-hr" />

            <div className="elv-welcome">
              <div className="elv-welcome-title">Bienvenido de nuevo</div>
              <div className="elv-welcome-sub">Inicia sesión para continuar en la plataforma operativa.</div>
            </div>
            <p className="elv-login-hint">
              Usa uno de los correos mock de desarrollo y la contraseña compartida para entrar al rol correcto.
            </p>

            <form className="elv-form" onSubmit={handleSubmit}>
              <div className="elv-field">
                <label htmlFor="elv-email" className="elv-label">Correo corporativo</label>
                <div className="elv-input-wrap">
                  <EmailIcon />
                  <input
                    id="elv-email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    placeholder="name@elevant.aero"
                    required
                    className="elv-input"
                  />
                </div>
              </div>

              <div className="elv-field">
                <label htmlFor="elv-pass" className="elv-label">Contraseña</label>
                <div className="elv-input-wrap">
                  <LockIcon />
                  <input
                    id="elv-pass"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••••••"
                    required
                    className="elv-input elv-input--password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="elv-eye-btn"
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </div>

              <div className="elv-row-between">
                <label className="elv-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                    className="elv-checkbox"
                  />
                  Recordarme
                </label>
                <a href="#" className="elv-link">¿Olvidaste tu contraseña?</a>
              </div>

              {errorMessage && (
                <div role="alert" className="elv-error">
                  {errorMessage}
                </div>
              )}

              <button ref={submitRef} type="submit" disabled={busy} className="elv-submit">
                {status === 'done' && <span className="elv-submit-done-bg" />}
                {ripple && (
                  <span
                    key={ripple.id}
                    className="elv-submit-ripple"
                    style={{ left: ripple.x - 60, top: ripple.y - 60 }}
                  />
                )}
                <span className="elv-submit-inner">
                  {status === 'busy' && <span className="elv-submit-spinner" />}
                  {status === 'done' && <CheckIcon />}
                  <span>{submitLabel}</span>
                  {status === 'idle' && <ArrowIcon />}
                </span>
              </button>
            </form>

            <div className="elv-trust-divider-row">
              <div className="elv-trust-hr" />
              <div className="elv-trust-label">Acceso exclusivo interno</div>
              <div className="elv-trust-hr" />
            </div>

            <div className="elv-trust-row">
              <ShieldIcon />
              Autenticación empresarial segura
            </div>
          </div>

          <div className="elv-footer-meta">
            <span>Versión 1.0</span>
            <span className="elv-footer-dot" />
            <span>© 2026 ELEVANT</span>
          </div>
        </div>
      </div>
    </div>
  );
}
