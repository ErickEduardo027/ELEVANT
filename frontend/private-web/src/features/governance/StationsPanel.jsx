import { useCallback, useEffect, useRef, useState } from 'react';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { isConflict, isForbidden } from '../../services/problemMessages';
import { COMMON_TIME_ZONES, createStation, listStations, stationMessage, updateStation } from '../../services/stationCatalogService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm disabled:opacity-60 dark:border-white/10 dark:bg-surface-dark';
const card = 'rounded-xl border border-black/5 bg-white p-6 dark:border-white/5 dark:bg-surface-dark-card';
const muted = 'text-text-secondary-light dark:text-text-secondary-dark';

/**
 * One command of the panel: the intent's Idempotency-Key (no answer or a 5xx retries with the same key and body) and
 * its Spanish message. A 409 or a 404 is explained by the panel, which reads the stations again first.
 */
function useCommand(onDone, onConflict, onRefused) {
  const keys = useRef(createCommandKeyHolder());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action, body, send, success) => {
    setBusy(true);
    setError('');
    try {
      const result = await keys.current.run(action, body, send);
      onDone(success(result));
      return true;
    } catch (failure) {
      if (isConflict(failure) || failure?.status === 404) {
        // The refused change is dropped: the row shows what the server keeps.
        onRefused?.();
        onConflict(stationMessage(failure));
      }
      else setError(stationMessage(failure));
      return false;
    } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function ZoneInput({ id, value, disabled, onChange, label = 'Zona horaria (IANA)' }) {
  return <label className="block text-xs font-semibold">{label}
    <input className={fieldClass} list={`${id}-zones`} required value={value} disabled={disabled} maxLength={64}
      placeholder="America/Santo_Domingo" onChange={event => onChange(event.target.value)} />
    <datalist id={`${id}-zones`}>{COMMON_TIME_ZONES.map(zone => <option key={zone} value={zone} />)}</datalist>
  </label>;
}

/** A new station: the IATA code of its airport. A known airport is reused; a new one needs its data. */
function StationForm({ airports, onDone, onConflict }) {
  const empty = { code: '', name: '', ianaTimeZone: 'America/Santo_Domingo', airportIcaoCode: '', airportName: '', airportCity: '',
    airportCountryCode: '' };
  const [draft, setDraft] = useState(empty);
  const command = useCommand(onDone, onConflict);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const code = draft.code.trim().toUpperCase();
  const known = airports.find(airport => airport.iataCode === code);
  const submit = async event => {
    event.preventDefault();
    const body = { code, name: draft.name.trim(), ianaTimeZone: draft.ianaTimeZone.trim(),
      ...(known ? {} : { airportIcaoCode: draft.airportIcaoCode.trim().toUpperCase(), airportName: draft.airportName.trim(),
        airportCity: draft.airportCity.trim(), airportCountryCode: draft.airportCountryCode.trim().toUpperCase() }) };
    if (await command.run('station.create', body, key => createStation(body, key),
      saved => `Estación ${saved.code} creada. Ya puede asignarse a contratos, usuarios y vuelos.`)) setDraft(empty);
  };
  return <form onSubmit={submit} aria-label="Nueva estación" className={`${card} space-y-3`}>
    <h2 className="text-lg font-bold">Nueva estación</h2>
    <p className={`text-sm ${muted}`}>El código es el IATA del aeropuerto y no cambia. La zona horaria define el día operativo de la estación.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block text-xs font-semibold">Código IATA
        <input className={`${fieldClass} font-mono`} required maxLength={3} value={draft.code} placeholder="SDQ"
          onChange={event => set('code', event.target.value.toUpperCase())} /></label>
      <label className="block text-xs font-semibold">Nombre
        <input className={fieldClass} required maxLength={120} value={draft.name} placeholder="AVIAM Santo Domingo"
          onChange={event => set('name', event.target.value)} /></label>
      <ZoneInput id="new-station" value={draft.ianaTimeZone} onChange={value => set('ianaTimeZone', value)} />
    </div>
    {code.length === 3 && (known
      ? <p role="status" className="text-sm">Aeropuerto registrado: {known.name} ({known.icaoCode}), {known.city}, {known.countryCode}.</p>
      : <fieldset className="grid gap-3 sm:grid-cols-4">
        <legend className="mb-1 text-xs font-semibold">Aeropuerto nuevo</legend>
        <label className="block text-xs font-semibold">Código OACI
          <input className={`${fieldClass} font-mono`} required maxLength={4} value={draft.airportIcaoCode} placeholder="MDSD"
            onChange={event => set('airportIcaoCode', event.target.value.toUpperCase())} /></label>
        <label className="block text-xs font-semibold">Nombre del aeropuerto
          <input className={fieldClass} required maxLength={180} value={draft.airportName}
            onChange={event => set('airportName', event.target.value)} /></label>
        <label className="block text-xs font-semibold">Ciudad
          <input className={fieldClass} required maxLength={120} value={draft.airportCity}
            onChange={event => set('airportCity', event.target.value)} /></label>
        <label className="block text-xs font-semibold">País (ISO, 2 letras)
          <input className={`${fieldClass} font-mono`} required maxLength={2} value={draft.airportCountryCode} placeholder="DO"
            onChange={event => set('airportCountryCode', event.target.value.toUpperCase())} /></label>
      </fieldset>)}
    {command.error && <p role="alert" className="text-sm text-status-danger">{command.error}</p>}
    <button type="submit" disabled={command.busy || code.length !== 3 || !draft.name.trim()}
      className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
      {command.busy ? 'Creando…' : 'Crear estación'}</button>
  </form>;
}

function StationRow({ station, onDone, onConflict }) {
  const initial = { name: station.name, ianaTimeZone: station.ianaTimeZone, isActive: station.isActive };
  const [draft, setDraft] = useState(initial);
  const command = useCommand(onDone, onConflict, () => setDraft(initial));
  const dirty = Object.keys(initial).some(key => draft[key] !== initial[key]);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const save = () => {
    const body = { name: draft.name.trim(), ianaTimeZone: draft.ianaTimeZone.trim(), isActive: draft.isActive,
      expectedVersion: station.version };
    return command.run('station.update', { id: station.id, ...body }, key => updateStation(station.id, body, key),
      saved => (saved.isActive === station.isActive ? `Estación ${saved.code} actualizada.`
        : saved.isActive ? `Estación ${saved.code} reactivada.` : `Estación ${saved.code} desactivada.`));
  };
  return <li className={`grid gap-3 py-4 lg:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end ${station.isActive ? '' : 'opacity-70'}`}>
    <div><p className="font-mono text-lg font-bold">{station.code}</p>
      <p className={`text-xs ${muted}`}>{station.airport.icaoCode} · {station.airport.city}</p></div>
    <label className="block text-xs font-semibold">Nombre
      <input className={fieldClass} aria-label={`Nombre de la estación ${station.code}`} maxLength={120} value={draft.name}
        onChange={event => set('name', event.target.value)} /></label>
    <div>
      <ZoneInput id={`station-${station.id}`} label={`Zona horaria de ${station.code}`} value={draft.ianaTimeZone}
        disabled={station.hasHistory} onChange={value => set('ianaTimeZone', value)} />
      {station.hasHistory && <p className={`mt-1 text-xs ${muted}`}>Con historial: la zona horaria no cambia.</p>}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.isActive}
        aria-label={`Estación ${station.code} activa`} onChange={event => set('isActive', event.target.checked)} />Activa</label>
      {dirty && <button type="button" disabled={command.busy || !draft.name.trim()} onClick={() => void save()}
        className="rounded-lg border border-accent-600 px-3 py-1.5 text-xs font-semibold text-accent-600 disabled:opacity-50">
        {command.busy ? 'Guardando…' : 'Guardar'}</button>}
    </div>
    {command.error && <p role="alert" className="text-xs text-status-danger lg:col-span-4">{command.error}</p>}
  </li>;
}

/**
 * «Estaciones» of Superadministración (2-A): a database that was never seeded, like Production, starts here. The
 * code never changes, the time zone only while the station has no history, and a station in use is never
 * deactivated; nothing is deleted.
 */
export default function StationsPanel() {
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState({ tone: '', text: '' });

  useEffect(() => {
    const controller = new AbortController();
    listStations({ signal: controller.signal })
      .then(data => setState({ status: 'success', data }))
      .catch(error => {
        if (error?.name === 'AbortError') return;
        setState(current => (current.data && !isForbidden(error) ? current : { status: 'error', error }));
      });
    return () => controller.abort();
  }, [attempt]);

  const reread = useCallback(text => { setFeedback({ tone: 'danger', text }); setAttempt(value => value + 1); }, []);
  const done = useCallback(text => { setFeedback({ tone: 'success', text }); setAttempt(value => value + 1); }, []);

  if (state.status === 'loading') return <div role="status" className={card}>Cargando estaciones…</div>;
  if (state.status === 'error' && isForbidden(state.error))
    return <p role="alert" className={`${card} text-sm`}>Solo el superadministrador gestiona las estaciones.</p>;
  if (state.status === 'error') return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">
    <span>{stationMessage(state.error)}</span>
    <button type="button" onClick={() => setAttempt(value => value + 1)} className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button>
  </div>;

  const { stations, availableAirports } = state.data;
  return <div className="space-y-5">
    {feedback.text && (feedback.tone === 'danger'
      ? <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{feedback.text}</p>
      : <p role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{feedback.text}</p>)}
    <StationForm airports={availableAirports} onDone={done} onConflict={reread} />
    <section className={card} aria-label="Estaciones registradas">
      <h2 className="text-lg font-bold">Estaciones registradas</h2>
      {stations.length === 0 ? <p role="status" className="mt-4 rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]">
        Aún no hay estaciones. Cree la primera: sin estación no se asignan contratos, usuarios ni vuelos.</p> :
        <ul className="mt-2 divide-y divide-black/5 dark:divide-white/5">{stations.map(station =>
          <StationRow key={`${station.id}-${station.version}`} station={station} onDone={done} onConflict={reread} />)}</ul>}
    </section>
  </div>;
}
