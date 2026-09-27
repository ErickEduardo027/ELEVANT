import { useState } from 'react';
import PasswordField from '../../components/PasswordField';
import './LoginPage.css';

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
    <main className="elv-shell">
      <div className="elv-right" style={{ marginInline: 'auto', minHeight: '100vh' }}>
        <div className="elv-panel">
          <section className="elv-card" aria-labelledby="activation-title">
            <h1 id="activation-title" className="elv-welcome-title">Activa tu cuenta</h1>
            <p className="elv-welcome-sub">Cambia la contraseña temporal de {email} antes de iniciar sesión. No recibirás una sesión hasta completar este paso.</p>
            <form className="elv-form" onSubmit={submit}>
              <PasswordField fieldClassName="elv-field" labelClassName="elv-label" inputClassName="elv-input" label="Contraseña temporal" id="current-password" name="currentPassword" autoComplete="current-password" required />
              <PasswordField fieldClassName="elv-field" labelClassName="elv-label" inputClassName="elv-input" label="Nueva contraseña" id="new-password" name="newPassword" autoComplete="new-password" minLength={14} maxLength={256} required />
              <PasswordField fieldClassName="elv-field" labelClassName="elv-label" inputClassName="elv-input" label="Confirmar nueva contraseña" id="confirm-password" name="confirmation" autoComplete="new-password" minLength={14} maxLength={256} required />
              {error && <p role="alert" className="elv-error">{error}</p>}
              <button type="submit" disabled={busy} className="elv-submit">{busy ? 'Cambiando…' : 'Cambiar contraseña'}</button>
              <button type="button" onClick={onCancel} disabled={busy} className="elv-link">Volver al inicio de sesión</button>
            </form>
          </section>
        </div>
      </div>
    </main>
  );
}
