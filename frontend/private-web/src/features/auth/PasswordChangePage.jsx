import { useState } from 'react';
import AuthVisualLayout from './AuthVisualLayout';
import PasswordField from '../../components/PasswordField';

export default function PasswordChangePage({ email, onSubmit, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = String(values.get('currentPassword') ?? '');
    const newPassword = String(values.get('newPassword') ?? '');
    const confirmation = String(values.get('confirmation') ?? '');
    if (newPassword !== confirmation) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onSubmit({ email, currentPassword, newPassword });
      form.reset();
    } catch (cause) {
      setError(cause?.message ?? 'No fue posible cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthVisualLayout>
      <section className="elv-auth-content" aria-labelledby="activation-title">
        <div className="elv-intro">
          <span className="elv-kicker">Seguridad de la cuenta</span>
          <h1 id="activation-title" className="elv-welcome-title">Activa tu cuenta</h1>
          <p className="elv-welcome-sub">
            Cambia la contraseña temporal de <span className="elv-activation-email">{email}</span> antes de iniciar sesión. No recibirás una sesión hasta completar este paso.
          </p>
        </div>
        <form className="elv-form" onSubmit={submit} aria-busy={busy}>
          <PasswordField fieldClassName="elv-field" labelClassName="elv-label" inputClassName="elv-input" label="Contraseña temporal" id="current-password" name="currentPassword" autoComplete="current-password" required disabled={busy} />
          <PasswordField fieldClassName="elv-field" labelClassName="elv-label" inputClassName="elv-input" label="Nueva contraseña" id="new-password" name="newPassword" autoComplete="new-password" minLength={14} maxLength={256} required disabled={busy} />
          <PasswordField fieldClassName="elv-field" labelClassName="elv-label" inputClassName="elv-input" label="Confirmar nueva contraseña" id="confirm-password" name="confirmation" autoComplete="new-password" minLength={14} maxLength={256} required disabled={busy} />
          {error && <p role="alert" className="elv-error">{error}</p>}
          <button type="submit" disabled={busy} className="elv-submit">
            {busy && <span className="elv-submit-spinner" aria-hidden="true" />}
            {busy ? 'Cambiando…' : 'Cambiar contraseña'}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className="elv-text-button elv-activation-cancel">Volver al inicio de sesión</button>
        </form>
      </section>
    </AuthVisualLayout>
  );
}
