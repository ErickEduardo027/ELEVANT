import { useEffect, useRef, useState } from 'react';
import AuthVisualLayout from './AuthVisualLayout';
import { resolveErrorCode } from './i18n/messages';
import { useAuthLanguage } from './i18n/useAuthLanguage';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.6-3.7 3.6-5.6 7.5-5.6s6.9 1.9 7.5 5.6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EyeIcon({ visible }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.7" />
      {!visible && <path d="M3.5 3.5 20.5 20.5" />}
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 5 6v5.5c0 4.3 2.9 7.6 7 9.5 4.1-1.9 7-5.2 7-9.5V6l-7-3Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 12h15M13.5 6.5 19 12l-5.5 5.5" />
    </svg>
  );
}

export default function LoginPage({ onSubmit = async () => {}, notice = '' }) {
  const { t } = useAuthLanguage();
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [showRecoveryHelp, setShowRecoveryHelp] = useState(false);
  const [status, setStatus] = useState('idle');
  const [authErrorCode, setAuthErrorCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const submitting = useRef(false);
  const resetTimer = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const busy = status !== 'idle';
  const credentialsInvalid = authErrorCode === 'invalid_credentials';
  const noticeText = notice ? t(`notices.${notice}`) : '';

  function clearFieldError(name) {
    setFieldErrors(current => (current[name] ? { ...current, [name]: '' } : current));
  }

  function validate(email, password) {
    const errors = {};
    if (!email.trim()) errors.email = 'emailRequired';
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'emailInvalid';
    if (!password) errors.password = 'passwordRequired';
    return errors;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (submitting.current || busy) return;

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');

    const errors = validate(email, password);
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setAuthErrorCode('');
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    submitting.current = true;
    setStatus('busy');
    setAuthErrorCode('');

    Promise.resolve(onSubmit({ email, password, remember }))
      .then(() => {
        setStatus('done');
        resetTimer.current = setTimeout(() => setStatus('idle'), 1200);
      })
      .catch(error => {
        setStatus('idle');
        setAuthErrorCode(resolveErrorCode(error));
      })
      .finally(() => {
        submitting.current = false;
      });
  }

  const emailError = fieldErrors.email ? t(`validation.${fieldErrors.email}`) : '';
  const passwordError = fieldErrors.password ? t(`validation.${fieldErrors.password}`) : '';
  const emailInvalid = Boolean(emailError) || credentialsInvalid;
  const passwordInvalid = Boolean(passwordError) || credentialsInvalid;

  return (
    <AuthVisualLayout>
      <section className="elv-auth-content" aria-labelledby="elv-login-title">
        <div className="elv-intro">
          <h1 id="elv-login-title" className="elv-welcome-title">
            {t('login.welcome')} <span className="elv-welcome-brand">ELEVANT</span>
          </h1>
          <p className="elv-welcome-sub">{t('login.subtitle')}</p>
        </div>

        <form className="elv-form" onSubmit={handleSubmit} aria-busy={busy} noValidate>
          <div className="elv-field">
            <label htmlFor="elv-email" className="elv-sr-only">{t('login.email')}</label>
            <div className="elv-input-wrap">
              <span className="elv-input-icon"><UserIcon /></span>
              <input
                ref={emailRef}
                id="elv-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t('login.email')}
                disabled={busy}
                aria-required="true"
                aria-invalid={emailInvalid || undefined}
                aria-describedby={emailError ? 'elv-email-error' : credentialsInvalid ? 'elv-login-error' : undefined}
                onChange={() => clearFieldError('email')}
                className="elv-input"
              />
            </div>
            {emailError && <p id="elv-email-error" className="elv-field-error">{emailError}</p>}
          </div>

          <div className="elv-field">
            <label htmlFor="elv-pass" className="elv-sr-only">{t('login.password')}</label>
            <div className="elv-input-wrap">
              <span className="elv-input-icon"><LockIcon /></span>
              <input
                ref={passwordRef}
                id="elv-pass"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder={t('login.password')}
                disabled={busy}
                aria-required="true"
                aria-invalid={passwordInvalid || undefined}
                aria-describedby={passwordError ? 'elv-pass-error' : credentialsInvalid ? 'elv-login-error' : undefined}
                onChange={() => clearFieldError('password')}
                className="elv-input elv-input--password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                aria-pressed={showPassword}
                disabled={busy}
                className="elv-eye-btn"
              >
                <EyeIcon visible={showPassword} />
              </button>
            </div>
            {passwordError && <p id="elv-pass-error" className="elv-field-error">{passwordError}</p>}
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
              <span>{t('login.remember')}</span>
            </label>
            <button
              type="button"
              className="elv-text-button"
              aria-expanded={showRecoveryHelp}
              aria-controls="elv-recovery-help"
              disabled={busy}
              onClick={() => setShowRecoveryHelp(value => !value)}
            >
              {t('login.forgot')}
            </button>
          </div>

          <p id="elv-recovery-help" className="elv-recovery-help" hidden={!showRecoveryHelp}>
            {t('login.recoveryHelp')}
          </p>
          {authErrorCode && <p id="elv-login-error" role="alert" className="elv-error">{t(`errors.${authErrorCode}`)}</p>}
          {noticeText && <p role="status" className="elv-notice">{noticeText}</p>}

          <button type="submit" disabled={busy} className="elv-submit">
            {status === 'busy' && <span className="elv-submit-spinner" aria-hidden="true" />}
            <span>{status === 'busy' ? t('login.submitting') : status === 'done' ? t('login.done') : t('login.submit')}</span>
            {status === 'idle' && <span className="elv-submit-arrow"><ArrowIcon /></span>}
          </button>
        </form>

        <p className="elv-access-note">
          <ShieldIcon />
          <span>{t('login.restricted')}</span>
        </p>
      </section>
    </AuthVisualLayout>
  );
}
