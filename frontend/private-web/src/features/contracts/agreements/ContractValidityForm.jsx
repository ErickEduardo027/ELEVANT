import { useRef, useState } from 'react';
import { setContractValidity } from '../../../services/commercialGovernanceApi';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { CONTRACT_VALIDITY_MESSAGES, contractValidityMessage } from '../../../services/commercialProblems';
import { isConflict } from '../../../services/problemMessages';

const input = 'rounded-lg border border-black/10 px-3 py-2 dark:border-white/10 dark:bg-surface-dark-card';

/**
 * Validity step Contratos completes after Finance approves the rates and before anyone signs
 * (ADR-0025): dates, renewal (manual or automatic), notice periods and termination terms.
 */
export default function ContractValidityForm({ document, onSaved }) {
  const current = document.validity;
  const [form, setForm] = useState({
    validFrom: document.validFrom, validTo: document.validTo ?? '',
    renewalMode: current?.renewalMode ?? 'Manual', renewalTermMonths: current?.renewalTermMonths ?? 12,
    renewalNoticeDays: current?.renewalNoticeDays ?? 30, terminationNoticeDays: current?.terminationNoticeDays ?? 60,
    terminationTerms: current?.terminationTerms ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keys = useRef(createCommandKeyHolder());
  const set = patch => setForm(value => ({ ...value, ...patch }));
  const number = value => (value === '' || value === null ? null : Number(value));

  async function submit(event) {
    event.preventDefault();
    if (!form.validFrom || !form.validTo || form.validTo <= form.validFrom) {
      setError(CONTRACT_VALIDITY_MESSAGES.dates_invalid);
      return;
    }
    setBusy(true);
    setError('');
    const request = {
      validFrom: form.validFrom, validTo: form.validTo, renewalMode: form.renewalMode,
      renewalTermMonths: number(form.renewalTermMonths), renewalNoticeDays: number(form.renewalNoticeDays) ?? 0,
      terminationNoticeDays: number(form.terminationNoticeDays) ?? 0, terminationTerms: form.terminationTerms,
      expectedDocumentSha256: document.contentSha256,
    };
    try {
      // The same key goes with a retry of the same intent after an uncertain result.
      const saved = await keys.current.run('validity', { versionId: document.versionId, ...request },
        key => setContractValidity(document.versionId, request, key));
      onSaved?.(saved);
    } catch (failure) {
      setError(failure instanceof TypeError ? 'Revisa los datos de la vigencia.'
        : contractValidityMessage(failure, { forbidden: 'Tu acceso no permite fijar la vigencia.',
          fallback: 'No fue posible guardar la vigencia. Revisa los datos e intenta de nuevo.' }));
      if (isConflict(failure)) onSaved?.(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Vigencia y renovación"
      className="space-y-3 rounded-lg border border-accent-600/30 p-3">
      <h3 className="font-semibold">{current ? 'Vigencia y renovación confirmadas' : 'Fijar vigencia y renovación'}</h3>
      <p className="text-xs text-text-secondary-light">
        Finanzas ya aprobó las tarifas. Confirma la vigencia antes de habilitar las firmas: primero firma la aerolínea y
        después AVIAM. Al confirmar, el contrato recibe su código definitivo.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">Inicio de la vigencia
          <input type="date" value={form.validFrom} onChange={event => set({ validFrom: event.target.value })} className={input} /></label>
        <label className="grid gap-1">Fin de la vigencia
          <input type="date" value={form.validTo} onChange={event => set({ validTo: event.target.value })} className={input} /></label>
        <label className="grid gap-1">Renovación
          <select value={form.renewalMode} onChange={event => set({ renewalMode: event.target.value })} className={input}>
            <option value="Manual">Manual: Contratos la inicia</option>
            <option value="Automatic">Automática: se inicia sola antes del vencimiento</option>
          </select></label>
        <label className="grid gap-1">Plazo de cada renovación (meses)
          <input type="number" min={1} max={60} value={form.renewalTermMonths ?? ''}
            onChange={event => set({ renewalTermMonths: event.target.value })} className={input} /></label>
        <label className="grid gap-1">Aviso de renovación (días antes)
          <input type="number" min={0} max={180} value={form.renewalNoticeDays}
            onChange={event => set({ renewalNoticeDays: event.target.value })} className={input} /></label>
        <label className="grid gap-1">Preaviso de terminación (días)
          <input type="number" min={0} max={180} value={form.terminationNoticeDays}
            onChange={event => set({ terminationNoticeDays: event.target.value })} className={input} /></label>
      </div>
      <label className="grid gap-1">Condiciones de terminación
        <textarea rows={3} maxLength={4000} value={form.terminationTerms}
          onChange={event => set({ terminationTerms: event.target.value })} className={input}
          placeholder="Ej.: incumplimiento grave de pago o de las normas de seguridad en rampa." /></label>
      {form.renewalMode === 'Automatic' && (
        <p className="text-xs text-text-secondary-light">
          La renovación automática crea la nueva versión {form.renewalNoticeDays || 0} días antes del fin; esa versión vuelve a
          pasar por Finanzas, la vigencia y las firmas. Nada se prorroga en silencio.
        </p>
      )}
      {error && <p role="alert" className="text-status-danger">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
        {busy ? 'Guardando…' : current ? 'Actualizar vigencia' : 'Confirmar vigencia'}</button>
    </form>
  );
}
