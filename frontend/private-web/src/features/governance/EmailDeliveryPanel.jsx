import { useCallback, useEffect, useRef, useState } from 'react';
import StatusBadge from '../../components/StatusBadge';
import { listEmailDeliveries, sendTestEmail } from '../../services/departmentGovernanceService';

const STATUS = {
  Pending: { label: 'Pendiente', tone: 'warning' },
  Sent: { label: 'Enviado', tone: 'success' },
  Failed: { label: 'Falló', tone: 'danger' },
};
const PURPOSE = { Activation: 'Activación', LoginCode: 'Código de acceso', PasswordReset: 'Recuperación', Test: 'Prueba' };
const stamp = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

/**
 * Super administrator check of the no-reply sender (ADR-0022): whether SMTP is configured, the
 * latest deliveries (never their bodies) and a test email, so the VPS setup can be confirmed
 * from the browser.
 */
export default function EmailDeliveryPanel({ pollMs = 3000 }) {
  const [state, setState] = useState({ status: 'loading', smtpConfigured: false, deliveries: [], error: '' });
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [watching, setWatching] = useState(null);
  const active = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await listEmailDeliveries();
      if (active.current) setState({ status: 'ready', smtpConfigured: data.smtpConfigured, deliveries: data.deliveries, error: '' });
      return data;
    } catch (failure) {
      if (active.current) setState(current => ({ ...current, status: failure.status === 403 ? 'forbidden' : 'error', error: failure.message }));
      return null;
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; };
  }, [load]);

  // After a test, re-read until that email leaves «Pendiente».
  useEffect(() => {
    if (!watching) return undefined;
    const timer = setInterval(() => {
      void load().then(data => {
        const delivery = data?.deliveries.find(item => item.id === watching);
        if (!delivery || delivery.status === 'Pending') return;
        setWatching(null);
        setNotice(delivery.status === 'Sent'
          ? `Correo de prueba enviado a ${delivery.recipient}. Revisa la bandeja (o spam).`
          : `El envío falló: ${delivery.lastError ?? 'sin detalle'}.`);
      });
    }, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs, watching]);

  async function submit(event) {
    event.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim())) { setNotice('Escribe un correo válido.'); return; }
    setBusy(true); setNotice('');
    try {
      const queued = await sendTestEmail(to.trim());
      setNotice(state.smtpConfigured ? 'Correo en cola; esperando la confirmación del servidor de correo…'
        : 'Correo en cola, pero SMTP no está configurado: quedará pendiente.');
      if (state.smtpConfigured) setWatching(queued.id);
      await load();
    } catch (failure) {
      setNotice(failure.message);
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="email-delivery-heading" className="rounded-xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-delivery-heading" className="text-lg font-bold">Correo del sistema</h2>
        {state.status === 'ready' && <StatusBadge tone={state.smtpConfigured ? 'success' : 'warning'}
          label={state.smtpConfigured ? 'SMTP configurado' : 'SMTP sin configurar: los correos quedan pendientes'} />}
      </div>
      <p className="mt-1 text-xs text-text-secondary-light">Remitente no-reply de los códigos de acceso, activaciones y recuperaciones del portal de aerolíneas.</p>
      {state.status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando envíos…</p>}
      {state.status === 'forbidden' && <p role="alert" className="mt-3 text-sm">Solo el superadministrador revisa el correo del sistema.</p>}
      {state.status === 'error' && <div role="alert" className="mt-3 text-sm"><p>{state.error}</p>
        <button type="button" onClick={() => void load()} className="mt-1 font-semibold text-accent-600 underline">Reintentar</button></div>}
      {state.status === 'ready' && (
        <>
          <form onSubmit={submit} noValidate className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-[16rem] flex-1 text-xs font-semibold">Enviar un correo de prueba a
              <input type="email" value={to} onChange={event => setTo(event.target.value)} maxLength={256}
                className="mt-1 block w-full rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" /></label>
            <button type="submit" disabled={busy || Boolean(watching)} className="min-h-[40px] rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Enviando…' : watching ? 'Esperando confirmación…' : 'Enviar correo de prueba'}</button>
          </form>
          {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
          {state.deliveries.length === 0 ? <p className="mt-4 text-sm text-text-secondary-light">Todavía no hay envíos.</p> : (
            <ul className="mt-4 divide-y divide-black/5 text-sm dark:divide-white/5" aria-label="Últimos envíos">
              {state.deliveries.map(item => (
                <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 [overflow-wrap:anywhere]"><strong>{PURPOSE[item.purpose] ?? item.purpose}</strong> · {item.recipient}
                    <span className="block text-xs text-text-secondary-light">{stamp(item.createdAt)} · {item.attempts} intento(s){item.lastError ? ` · ${item.lastError}` : ''}</span></span>
                  <StatusBadge tone={STATUS[item.status]?.tone} label={STATUS[item.status]?.label ?? item.status} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
