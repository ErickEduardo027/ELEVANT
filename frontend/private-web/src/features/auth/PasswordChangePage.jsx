import { useState } from 'react';
import AuthVisualLayout from './AuthVisualLayout';
import PasswordField from '../../components/PasswordField';
import { resolveErrorCode } from './i18n/messages';
import { useAuthLanguage } from './i18n/useAuthLanguage';

export default function PasswordChangePage({ email, onSubmit, onCancel }) {
  const { t } = useAuthLanguage();
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get('currentPassword') ?? '');
    const newPassword = String(values.get('newPassword') ?? '');
    const confirmation = String(values.get('confirmation') ?? '');
    if (newPassword !== confirmation) {
      setErrorCode('confirmation_mismatch');
      return;
    }

    setBusy(true);
    setErrorCode('');
    try {
      await onSubmit({ email, currentPassword, newPassword });
      form.reset();
    } catch (cause) {
      setErrorCode(resolveErrorCode(cause, 'change_generic'));
    } finally {
      setBusy(false);
    }
  }

  const fieldProps = {
    fieldClassName: 'elv-field',
    labelClassName: 'elv-label',
    inputClassName: 'elv-input',
    showVerb: t('activation.show'),
    hideVerb: t('activation.hide'),
    required: true,
    disabled: busy,
  };
  const errorText = errorCode === 'confirmation_mismatch' ? t('validation.confirmationMismatch') : errorCode ? t(`errors.${errorCode}`) : '';
  const [subtitleStart, subtitleEnd] = t('activation.subtitle', { email: '\u0000' }).split('\u0000');

  return (
    <AuthVisualLayout>
      <section className="elv-auth-content" aria-labelledby="activation-title">
        <div className="elv-intro">
          <h1 id="activation-title" className="elv-welcome-title">{t('activation.title')}</h1>
          <p className="elv-welcome-sub">
            {subtitleStart}<span className="elv-activation-email">{email}</span>{subtitleEnd}
          </p>
        </div>
        <form className="elv-form" onSubmit={submit} aria-busy={busy}>
          <PasswordField {...fieldProps} label={t('activation.current')} id="current-password" name="currentPassword" autoComplete="current-password" />
          <PasswordField {...fieldProps} label={t('activation.next')} id="new-password" name="newPassword" autoComplete="new-password" minLength={14} maxLength={256} />
          <PasswordField {...fieldProps} label={t('activation.confirm')} id="confirm-password" name="confirmation" autoComplete="new-password" minLength={14} maxLength={256} />
          {errorText && <p role="alert" className="elv-error">{errorText}</p>}
          <button type="submit" disabled={busy} className="elv-submit">
            {busy && <span className="elv-submit-spinner" aria-hidden="true" />}
            {busy ? t('activation.submitting') : t('activation.submit')}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="elv-text-button elv-activation-cancel">{t('activation.back')}</button>
        </form>
      </section>
    </AuthVisualLayout>
  );
}
