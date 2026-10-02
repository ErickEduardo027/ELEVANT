import { useEffect, useRef, useState } from 'react';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { recordHumanResourcesAvailabilityRequest } from
  '../../../services/humanResourcesAvailabilityService';

function validDates(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return false;
  if ([start, end].some(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value;
  })) return false;
  const days = (Date.parse(`${end}T00:00:00Z`) -
    Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
  return Number.isInteger(days) && days <= 30;
}

export default function AvailabilityRequestForm({ initialDate, canWrite = true,
  onClose, onRecorded, onConflict, onDenied }) {
  const [catalog, setCatalog] = useState({ status: 'loading', profiles: [] });
  const [rampProfileId, setRampProfileId] = useState('');
  const [startsOn, setStartsOn] = useState(initialDate);
  const [endsOn, setEndsOn] = useState(initialDate);
  const [type, setType] = useState('DayOff');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const denied = useRef(false);
  const onDeniedRef = useRef(onDenied);
  onDeniedRef.current = onDenied;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getRampProfiles().then(result => {
      if (active && !denied.current) setCatalog({ status: 'ready',
        profiles: result.profiles.filter(profile => profile.isActive) });
    }).catch(failure => {
      if (!active || denied.current) return;
      if (failure?.status === 401 || failure?.status === 403) {
        denied.current = true;
        onDeniedRef.current(failure.status);
      } else setCatalog({ status: 'error', profiles: [] });
    });
    return () => { active = false; };
  }, []);

  function change(setter, value) {
    setter(value);
    setPending(null);
    setError('');
  }

  async function submit() {
    if (busy || !canWrite || denied.current || catalog.status !== 'ready' ||
        !catalog.profiles.some(profile => profile.id === rampProfileId)) return;
    if (!validDates(startsOn, endsOn) || !reason.trim() ||
        reason.trim().length > 1000) {
      setError('Indica un motivo y un intervalo válido de hasta 31 fechas locales.');
      return;
    }
    const request = { rampProfileId, startsOn, endsOn, type, reason: reason.trim() };
    const intent = pending ?? { id: crypto.randomUUID(), request };
    setPending(intent);
    setBusy(true);
    setError('');
    try {
      const receipt = await recordHumanResourcesAvailabilityRequest(
        intent.id, intent.request);
      if (!mounted.current || denied.current) return;
      setPending(null);
      onRecorded(receipt);
    } catch (failure) {
      if (!mounted.current || denied.current) return;
      if (failure?.status === 401 || failure?.status === 403) {
        denied.current = true;
        setPending(null);
        onDeniedRef.current(failure.status);
      } else if (failure?.status === 409) {
        setPending(null);
        onConflict();
        setError('La solicitud cambió o se solapa con otra. Revisa la lista actualizada.');
      } else if (failure?.status === 400 || failure?.status === 404) {
        setPending(null);
        setError('No se pudo registrar. Comprueba el agente, las fechas y el motivo.');
      } else {
        setError('No pudimos confirmar el resultado. Reintenta la misma solicitud sin modificarla.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return <section className="rounded-2xl border border-accent-600/20 bg-white p-5 shadow-sm dark:bg-surface-dark-card">
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-lg font-bold">Registrar solicitud</h3>
      <button type="button" disabled={busy} onClick={onClose}
        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Cerrar</button>
    </div>
    <p className="mt-1 text-sm text-text-secondary-light">Una solicitud aprobada de día libre o restricción bloquea nuevas asignaciones OCC en las fechas indicadas.</p>
    {catalog.status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando agentes…</p>}
    {catalog.status === 'error' && <p role="alert" className="mt-3 text-sm text-status-danger">
      No se pudieron cargar los agentes. Cierra y vuelve a intentarlo.
    </p>}
    {catalog.status === 'ready' && <form className="mt-4 grid gap-4 md:grid-cols-2"
      onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label className="text-sm font-semibold">Agente
        <select required value={rampProfileId} disabled={busy || !!pending}
          onChange={event => change(setRampProfileId, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona un agente</option>
          {catalog.profiles.map(profile => <option key={profile.id} value={profile.id}>
            {profile.employeeNumber} · {profile.firstName} {profile.lastName}
          </option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Tipo
        <select value={type} disabled={busy || !!pending}
          onChange={event => change(setType, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="DayOff">Día libre</option>
          <option value="Restriction">Restricción</option>
          <option value="ShiftChange">Cambio de turno solicitado</option>
        </select>
      </label>
      <label className="text-sm font-semibold">Desde
        <input required type="date" value={startsOn} disabled={busy || !!pending}
          onChange={event => change(setStartsOn, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      <label className="text-sm font-semibold">Hasta
        <input required type="date" value={endsOn} disabled={busy || !!pending}
          onChange={event => change(setEndsOn, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      <label className="md:col-span-2 text-sm font-semibold">Motivo
        <textarea required maxLength={1000} value={reason} disabled={busy || !!pending}
          onChange={event => change(setReason, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      {error && <p role="alert" className="md:col-span-2 text-sm text-status-danger">{error}</p>}
      <div className="md:col-span-2 flex flex-wrap gap-3">
        <button type="submit" disabled={busy || !canWrite || !rampProfileId || !reason.trim()}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? 'Guardando…' : 'Registrar solicitud'}
        </button>
        {pending && error.startsWith('No pudimos confirmar') && <button type="button"
          disabled={busy} onClick={() => void submit()}
          className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Reintentar la misma solicitud</button>}
      </div>
    </form>}
  </section>;
}
