import { useEffect, useRef, useState } from 'react';
import AuthVisualLayout from './AuthVisualLayout';

function EyeIcon({ visible }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.7" />
      {!visible && <path d="M3.5 3.5 20.5 20.5" />}
    </svg>
  );
}

export default function LoginPage({ onSubmit = async () => {}, notice = '' }) {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const busy = status !== 'idle';
  const credentialsInvalid = errorMessage === 'Credenciales inválidas.';

  function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    setStatus('busy');
    setErrorMessage('');

    Promise.resolve(onSubmit({ email, password, remember }))
      .then(() => {
        setStatus('done');
        resetTimer.current = setTimeout(() => setStatus('idle'), 1200);
      })
      .catch(error => {
        setStatus('idle');
        setErrorMessage(error?.message ?? 'No fue posible iniciar sesión.');
      });
  }

  return (
    <AuthVisualLayout>
      <section className="elv-auth-content" aria-labelledby="elv-login-title">
        <div className="elv-intro">
          <span className="elv-kicker">Espacio de trabajo</span>
          <h1 id="elv-login-title" className="elv-welcome-title">Bienvenido de nuevo</h1>
          <p className="elv-welcome-sub">Accede con tu cuenta autorizada para continuar con la operación.</p>
        </div>

        <form className="elv-form" onSubmit={handleSubmit} aria-busy={busy}>
          <div className="elv-field">
            <label htmlFor="elv-email" className="elv-label">Correo corporativo</label>
            <input
              id="elv-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="nombre@empresa.com"
              required
              disabled={busy}
              aria-invalid={credentialsInvalid || undefined}
              aria-describedby={credentialsInvalid ? 'elv-login-error' : undefined}
              className="elv-input"
            />
          </div>

          <div className="elv-field">
            <label htmlFor="elv-pass" className="elv-label">Contraseña</label>
            <div className="elv-input-wrap">
              <input
                id="elv-pass"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Introduce tu contraseña"
                required
                disabled={busy}
                aria-invalid={credentialsInvalid || undefined}
                aria-describedby={credentialsInvalid ? 'elv-login-error' : undefined}
                className="elv-input elv-input--password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                disabled={busy}
                className="elv-eye-btn"
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>
          </div>

          <div className="elv-row-between">
            <label className="elv-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={event => setRemember(event.target.checked)}
                disabled={busy}
                className="elv-checkbox"
              />
              <span>Recordarme</span>
            </label>
            <button
              type="button"
              className="elv-text-button"
              aria-expanded={showRecoveryHelp}
              aria-controls="elv-recovery-help"
              disabled={busy}
              onClick={() => setShowRecoveryHelp(value => !value)}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>

          <p id="elv-recovery-help" className="elv-recovery-help" hidden={!showRecoveryHelp}>
            La recuperación en línea aún no está disponible. Contacta al equipo responsable de tu acceso para recibir ayuda.
          </p>
          {errorMessage && <p id="elv-login-error" role="alert" className="elv-error">{errorMessage}</p>}
          {notice && <p role="status" className="elv-notice">{notice}</p>}

          <button type="submit" disabled={busy} className="elv-submit">
            {status === 'busy' && <span className="elv-submit-spinner" aria-hidden="true" />}
            <span>{status === 'busy' ? 'Autenticando…' : status === 'done' ? 'Acceso concedido' : 'Iniciar sesión'}</span>
            {status === 'idle' && <span className="elv-submit-arrow" aria-hidden="true">↗</span>}
          </button>
        </form>

        <p className="elv-access-note">Acceso reservado para personal autorizado de AVIAM.</p>
      </section>
    </AuthVisualLayout>
  );
}
