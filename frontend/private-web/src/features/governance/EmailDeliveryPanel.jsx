import { useCallback, useEffect, useRef, useState } from 'react';
import StatusBadge from '../../components/StatusBadge';
import { listEmailDeliveries, sendTestEmail } from '../../services/departmentGovernanceService';
import { commercialGovernanceMessage } from '../../services/commercialProblems';
import { reasonLabel } from '../../services/emailDeliveries';
import EmailOutboxPanel from './EmailOutboxPanel';

/**
 * Super administrator check of the no-reply sender (ADR-0022): whether SMTP is configured, a test email
 * followed until the server reports it, and the outbox with the reason and the subject of every email
 * (1-N22), so the VPS setup and a failed delivery can be followed from the browser.
 */
export default function EmailDeliveryPanel({ pollMs = 3000 }) {
  const [state, setState] = useState({ status: 'loading', smtpConfigured: false, failure: null });
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [watching, setWatching] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const active = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await listEmailDeliveries();
      if (active.current) setState({ status: 'ready', smtpConfigured: data.smtpConfigured, failure: null });
      return data;
    } catch (failure) {
      if (active.current) setState(current => ({ ...current, status: failure?.status === 403 ? 'forbidden' : 'error', failure }));
      return null;
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; };
  }, [load]);

  // After a test, re-read until that email leaves the queue.
  useEffect(() => {
    if (!watching) return undefined;
    const timer = setInterval(() => {
      void load().then(data => {
        const delivery = data?.deliveries.find(item => item.id === watching);
        if (!delivery || delivery.status === 'Pending') return;
        setWatching(null);
        setReloadKey(current => current + 1);
        setNotice(delivery.status === 'Sent'
          ? `Correo de prueba enviado a ${delivery.recipient}: el servidor de correo lo aceptó. Revisa la bandeja (o spam).`
          : `La prueba no salió: ${reasonLabel(delivery.lastError) ?? 'el servidor no informó el motivo.'}`);
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
      setReloadKey(current => current + 1);
    } catch (failure) {
      setNotice(commercialGovernanceMessage(failure, { fallback: 'No se pudo dejar en cola la prueba. Intente de nuevo.' }));
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="email-delivery-heading" className="rounded-xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="email-delivery-heading" className="text-lg font-bold">Correo del sistema</h2>
        {state.status === 'ready' && <StatusBadge tone={state.smtpConfigured ? 'success' : 'warning'}
          label={state.smtpConfigured ? 'SMTP configurado' : 'SMTP sin configurar: los correos quedan pendientes'} />}
      </div>
      <p className="mt-1 text-xs text-text-secondary-light">Remitente no-reply de las invitaciones, códigos de acceso, recuperaciones, contratos, facturas y decisiones de solicitudes. Un correo «En cola» todavía no salió.</p>
      {state.status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando envíos…</p>}
      {state.status === 'forbidden' && <p role="alert" className="mt-3 text-sm">Solo el superadministrador revisa el correo del sistema.</p>}
      {state.status === 'error' && <div role="alert" className="mt-3 text-sm"><p>{commercialGovernanceMessage(state.failure, { fallback: 'No se pudo consultar el correo del sistema.' })}</p>
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
          <EmailOutboxPanel reloadKey={reloadKey} />
        </>
      )}
    </section>
  );
}
