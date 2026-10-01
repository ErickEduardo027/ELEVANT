import { useEffect, useRef, useState } from 'react';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { getHumanResourcesShiftAssignmentOptions, recordHumanResourcesShift } from
  '../../../services/humanResourcesShiftsReadService';

function validInterval(start, end) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || start === end) return false;
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const duration = (minutes(end) - minutes(start) + 1440) % 1440;
  return duration > 0 && duration <= 16 * 60;
}

export default function ShiftRecordForm({ initialWorkDate, onRecorded, onClose, onDenied,
  canWrite = true }) {
  const [rampProfileId, setRampProfileId] = useState('');
  const [workDate, setWorkDate] = useState(initialWorkDate);
  const [stationId, setStationId] = useState('');
  const [terminalId, setTerminalId] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState('06:00');
  const [endsAtLocal, setEndsAtLocal] = useState('14:00');
  const [notes, setNotes] = useState('');
  const [catalog, setCatalog] = useState({ status: 'loading', profiles: [] });
  const [options, setOptions] = useState({ status: 'idle', stations: [], hasShift: false });
  const [optionsRevision, setOptionsRevision] = useState(0);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const denied = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function deny(status) {
    denied.current = true;
    setOptions({ status: 'denied', stations: [], hasShift: false });
    setPending(null);
    onDenied(status);
  }

  useEffect(() => {
    let active = true;
    getRampProfiles()
      .then(result => {
        if (active && !denied.current) setCatalog({ status: 'ready',
          profiles: result.profiles.filter(profile => profile.isActive) });
      })
      .catch(failure => {
        if (!active) return;
        if (failure?.status === 401 || failure?.status === 403) deny(failure.status);
        else setCatalog({ status: 'error', profiles: [] });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!rampProfileId || !workDate || denied.current) {
      if (!denied.current) setOptions({ status: 'idle', stations: [], hasShift: false });
      return undefined;
    }
    const controller = new AbortController();
    setOptions({ status: 'loading', stations: [], hasShift: false });
    getHumanResourcesShiftAssignmentOptions({ rampProfileId, workDate },
      { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted && !denied.current)
          setOptions({ ...result, status: 'ready' });
      })
      .catch(failure => {
        if (controller.signal.aborted || failure?.name === 'AbortError' || denied.current) return;
        if (failure?.status === 401 || failure?.status === 403) deny(failure.status);
        else setOptions({ status: 'error', stations: [], hasShift: false });
      });
    return () => controller.abort();
  }, [rampProfileId, workDate, optionsRevision]);

  function changeAgent(value) {
    setRampProfileId(value);
    setStationId('');
    setTerminalId('');
    setPending(null);
    setError('');
  }

  function changeDate(value) {
    setWorkDate(value);
    setStationId('');
    setTerminalId('');
    setPending(null);
    setError('');
  }

  function changeField(setter, value) {
    setter(value);
    setPending(null);
    setError('');
  }

  async function submitRecord() {
    const station = options.stations.find(item => item.id === stationId);
    if (busy || !canWrite || denied.current || catalog.status !== 'ready' || options.status !== 'ready' ||
        options.rampProfileId !== rampProfileId || options.workDate !== workDate ||
        options.hasShift || !station?.terminals.some(item => item.id === terminalId)) return;
    if (!validInterval(startsAtLocal, endsAtLocal) || notes.trim().length > 500) {
      setError('El horario debe durar más de cero y hasta 16 horas; las notas admiten 500 caracteres.');
      return;
    }
    const request = { rampProfileId, stationId, terminalId, workDate,
      startsAtLocal: `${startsAtLocal}:00`, endsAtLocal: `${endsAtLocal}:00`,
      notes: notes.trim() || null };
    const intent = pending ?? { id: crypto.randomUUID(), request };
    setPending(intent);
    setBusy(true);
    setError('');
    try {
      const receipt = await recordHumanResourcesShift(intent.id, intent.request);
      if (!mounted.current || denied.current) return;
      setPending(null);
      onRecorded(receipt);
    } catch (failure) {
      if (!mounted.current || denied.current) return;
      if (failure?.status === 409) {
        setPending(null);
        setOptions({ status: 'loading', stations: [], hasShift: false });
        setOptionsRevision(value => value + 1);
        setError('La asignación cambió. Consultamos de nuevo antes de permitir otra intención.');
      } else if (failure?.status === 401 || failure?.status === 403) {
        deny(failure.status);
      } else if (failure?.status === 400 || failure?.status === 404) {
        setPending(null);
        setOptions({ status: 'loading', stations: [], hasShift: false });
        setOptionsRevision(value => value + 1);
        setError('No se pudo guardar. Comprueba la fecha, el horario y los alcances actuales.');
      } else {
        setError('No pudimos confirmar el resultado. Reintenta el mismo registro sin modificarlo para evitar duplicados.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const selectedStation = options.stations.find(item => item.id === stationId);
  const canSubmit = !busy && canWrite && !denied.current && catalog.status === 'ready' &&
    options.status === 'ready' && options.rampProfileId === rampProfileId &&
    options.workDate === workDate && !options.hasShift &&
    !!selectedStation?.terminals.some(item => item.id === terminalId);
  return <section className="rounded-2xl border border-accent-600/20 bg-white p-5 shadow-sm dark:bg-surface-dark-card">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">Registrar turno de rampa</h2>
      <button type="button" disabled={busy} onClick={onClose}
        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Cerrar</button>
    </div>
    <p className="mt-1 text-sm text-text-secondary-light">La fecha y las horas son locales a la estación elegida.</p>
    {catalog.status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando agentes…</p>}
    {catalog.status === 'error' && <p role="alert" className="mt-3 text-sm text-status-danger">
      No se pudieron cargar los agentes. Cierra y vuelve a intentarlo.
    </p>}
    {catalog.status === 'ready' && <form className="mt-4 grid gap-4 md:grid-cols-2"
      onSubmit={event => { event.preventDefault(); void submitRecord(); }}>
      <label className="text-sm font-semibold">Agente de rampa
        <select required disabled={busy} value={rampProfileId}
          onChange={event => changeAgent(event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona un agente</option>
          {catalog.profiles.map(profile => <option key={profile.id} value={profile.id}>
            {profile.employeeNumber} · {profile.firstName} {profile.lastName}
          </option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Fecha del turno
        <input required type="date" disabled={busy} value={workDate}
          onChange={event => changeDate(event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      {options.status === 'loading' && <p role="status" className="md:col-span-2 text-sm">
        Consultando estaciones y terminales autorizadas…</p>}
      {options.status === 'error' && <p role="alert" className="md:col-span-2 text-sm text-status-danger">
        No se pudieron consultar los alcances actuales.
        <button type="button" onClick={() => setOptionsRevision(value => value + 1)}
          className="ml-2 underline">Reintentar consulta</button>
      </p>}
      {options.status === 'ready' && options.hasShift && <p className="md:col-span-2 rounded-lg bg-status-warning/10 p-3 text-sm">
        Ya hay un turno registrado para este agente y día. Consulta la lista antes de cambiar la planificación.
      </p>}
      {options.status === 'ready' && !options.hasShift && options.stations.length === 0 &&
        <p className="md:col-span-2 rounded-lg border p-3 text-sm">
          El agente no tiene estación y terminal activas para esta fecha.
        </p>}
      <label className="text-sm font-semibold">Estación
        <select required disabled={busy || options.status !== 'ready' || options.hasShift}
          value={stationId} onChange={event => { changeField(setStationId, event.target.value); setTerminalId(''); }}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona una estación</option>
          {options.status === 'ready' && options.stations.map(station =>
            <option key={station.id} value={station.id}>{station.code}</option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Terminal
        <select required disabled={busy || !selectedStation || options.hasShift}
          value={terminalId} onChange={event => changeField(setTerminalId, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona una terminal</option>
          {selectedStation?.terminals.map(terminal =>
            <option key={terminal.id} value={terminal.id}>{terminal.code}</option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Inicio local
        <input required type="time" disabled={busy} value={startsAtLocal}
          onChange={event => changeField(setStartsAtLocal, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      <label className="text-sm font-semibold">Fin local
        <input required type="time" disabled={busy} value={endsAtLocal}
          onChange={event => changeField(setEndsAtLocal, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      <label className="md:col-span-2 text-sm font-semibold">Notas (opcional)
        <textarea maxLength={500} disabled={busy} value={notes}
          onChange={event => changeField(setNotes, event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      {error && <p role="alert" className="md:col-span-2 text-sm text-status-danger">{error}</p>}
      <div className="md:col-span-2 flex flex-wrap gap-3">
        <button type="submit" disabled={!canSubmit}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? 'Guardando…' : 'Registrar turno'}
        </button>
        {pending && error.startsWith('No pudimos confirmar') && <button type="button"
          disabled={busy} onClick={() => void submitRecord()}
          className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Reintentar el mismo registro</button>}
      </div>
    </form>}
  </section>;
}
