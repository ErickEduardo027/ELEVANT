import { useEffect, useState } from 'react';

const TYPE_LABELS = { additionalService: 'Servicio adicional', affiliation: 'Afiliación' };
const STATUS_LABELS = { pending: 'Pendiente', inReview: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' };

function formatDateTime(value) {
  if (!value) return 'Pendiente';
  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function RequestDetailModal({ request, onClose, onBeginReview, onResolve }) {
  const [decision, setDecision] = useState('approved');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDecision(request?.status === 'rejected' ? 'rejected' : 'approved');
    setNote(request?.decisionNote ?? '');
    setError('');
  }, [request]);

  if (!request) return null;
  const resolved = ['approved', 'rejected'].includes(request.status);

  async function handleBeginReview() {
    setSaving(true);
    try {
      await onBeginReview(request.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleResolve(event) {
    event.preventDefault();
    if (!note.trim()) {
      setError('Registra una observación antes de atender la solicitud.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onResolve(request.id, { status: decision, decisionNote: note });
      onClose();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="request-detail-title" className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-surface-dark-card">
        <header className="flex items-start justify-between border-b border-black/5 px-6 py-5 dark:border-white/5">
          <div>
            <p className="font-mono text-xs font-semibold text-signal-500">{request.id}</p>
            <h2 id="request-detail-title" className="mt-1 text-xl font-bold text-ink-900 dark:text-text-primary-dark">{request.airline}</h2>
            <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{TYPE_LABELS[request.type]} · {STATUS_LABELS[request.status]}</p>
          </div>
          <button type="button" aria-label="Cerrar detalle" onClick={onClose} className="rounded-lg p-2 text-text-secondary-light hover:bg-black/5 dark:hover:bg-white/5">✕</button>
        </header>

        <div className="space-y-5 p-6">
          <dl className="grid gap-4 rounded-xl bg-black/[0.025] p-4 text-sm dark:bg-white/[0.025] sm:grid-cols-2">
            <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Contacto</dt><dd className="mt-1 font-semibold">{request.contactName}</dd></div>
            <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Correo</dt><dd className="mt-1 break-all font-semibold">{request.contactEmail}</dd></div>
            <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Recibida</dt><dd className="mt-1 font-semibold">{formatDateTime(request.receivedAt)}</dd></div>
            <div><dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Notificación</dt><dd className="mt-1 font-semibold">{formatDateTime(request.notifiedAt)}</dd></div>
          </dl>

          <div>
            <h3 className="text-sm font-semibold">Detalle de la solicitud</h3>
            <p className="mt-2 rounded-xl border border-black/10 p-4 text-sm leading-6 dark:border-white/10">{request.requestedService}</p>
          </div>

          {request.status === 'pending' && (
            <button type="button" onClick={handleBeginReview} disabled={saving} className="w-full rounded-xl border border-accent-600 px-4 py-2.5 text-sm font-semibold text-accent-600 hover:bg-accent-600/5 disabled:opacity-60">Marcar en revisión</button>
          )}

          {request.status === 'inReview' && (
            <form onSubmit={handleResolve} className="space-y-4 border-t border-black/5 pt-5 dark:border-white/5">
              <fieldset>
                <legend className="text-sm font-semibold">Resultado de la evaluación</legend>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <label className={`cursor-pointer rounded-xl border p-3 text-center text-sm font-semibold ${decision === 'approved' ? 'border-status-success bg-status-success/10 text-status-success' : 'border-black/10 dark:border-white/10'}`}><input className="sr-only" type="radio" name="decision" value="approved" checked={decision === 'approved'} onChange={() => setDecision('approved')} />Aprobar</label>
                  <label className={`cursor-pointer rounded-xl border p-3 text-center text-sm font-semibold ${decision === 'rejected' ? 'border-status-danger bg-status-danger/10 text-status-danger' : 'border-black/10 dark:border-white/10'}`}><input className="sr-only" type="radio" name="decision" value="rejected" checked={decision === 'rejected'} onChange={() => setDecision('rejected')} />Rechazar</label>
                </div>
              </fieldset>
              <label htmlFor="request-decision-note" className="block text-sm font-semibold">Observación para el solicitante<textarea id="request-decision-note" value={note} onChange={event => { setNote(event.target.value); setError(''); }} rows={4} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-accent-600 dark:border-white/10 dark:bg-surface-dark" placeholder="Explica brevemente el resultado…" /></label>
              {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
              <button type="submit" disabled={saving} className="w-full rounded-xl bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Guardando…' : 'Atender y notificar'}</button>
            </form>
          )}

          {resolved && (
            <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">Resultado comunicado</p>
              <p className="mt-2 text-sm">{request.decisionNote}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
