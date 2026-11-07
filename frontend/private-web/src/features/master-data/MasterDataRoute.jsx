import { useCallback, useEffect, useRef, useState } from 'react';
import { OccStationBadge } from '../admin-occ/OccQueueState';
import { useOccStation } from '../admin-occ/useOccStation';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { isConflict, isForbidden } from '../../services/problemMessages';
import {
  AIRCRAFT_SIZES, createOccAircraftType, createOccStand, createOccTerminal, loadOccMasterData, masterDataMessage,
  updateOccAircraftType, updateOccStand, updateOccTerminal,
} from '../../services/occMasterDataService';

const card = 'rounded-2xl border border-black/5 bg-white/80 p-5 dark:border-white/5 dark:bg-surface-dark-card';
const muted = 'text-text-secondary-light dark:text-text-secondary-dark';
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:opacity-50';
const primary = `${button} bg-accent-600 text-white`;
const secondary = `${button} border border-accent-600/40 text-accent-600`;
const input = 'min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-sm disabled:opacity-60 dark:border-white/10 dark:bg-surface-dark';

/**
 * One command of the screen: the intent's Idempotency-Key (a 5xx or a network failure retries with the same key and
 * body) and the Spanish message of a refusal. A 409 or a 404 is explained by the page, which reads the data again so
 * the next attempt starts from fresh versions.
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
        onConflict(masterDataMessage(failure));
      }
      else setError(masterDataMessage(failure));
      return false;
    } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function Failure({ text }) {
  return text ? <p role="alert" className="text-xs text-status-danger">{text}</p> : null;
}

function Flag({ label, checked, disabled, onChange }) {
  return <label className="flex min-h-11 items-center gap-1.5 text-xs">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />{label}</label>;
}

function SizeSelect({ label, value, disabled, onChange, emptyLabel = 'Cualquier tamaño' }) {
  return <label className="space-y-1 text-xs font-medium">{label}
    <select className={`${input} w-44`} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {Object.entries(AIRCRAFT_SIZES).map(([size, text]) => <option key={size} value={size}>{text}</option>)}
    </select></label>;
}

function TerminalRow({ terminal, canUpdate, onDone, onConflict }) {
  const [draft, setDraft] = useState({ code: terminal.code, name: terminal.name, isActive: terminal.isActive });
  const command = useCommand(onDone, onConflict,
    () => setDraft({ code: terminal.code, name: terminal.name, isActive: terminal.isActive }));
  const dirty = draft.code !== terminal.code || draft.name !== terminal.name || draft.isActive !== terminal.isActive;
  const save = () => {
    const body = { code: draft.code, name: draft.name, isActive: draft.isActive, expectedVersion: terminal.version };
    return command.run('terminal.update', { id: terminal.id, ...body }, key => updateOccTerminal(terminal.id, body, key),
      saved => (saved.isActive === terminal.isActive ? `Terminal ${saved.code} actualizada.`
        : saved.isActive ? `Terminal ${saved.code} reactivada.` : `Terminal ${saved.code} desactivada.`));
  };
  return <li className={`flex flex-wrap items-end gap-3 py-3 ${terminal.isActive ? '' : 'opacity-70'}`}>
    <label className="space-y-1 text-xs font-medium">Código
      <input className={`${input} w-28 font-mono`} aria-label={`Código de la terminal ${terminal.code}`} value={draft.code}
        disabled={!canUpdate || terminal.hasHistory} maxLength={16}
        onChange={event => setDraft(value => ({ ...value, code: event.target.value.toUpperCase() }))} /></label>
    <label className="min-w-48 flex-1 space-y-1 text-xs font-medium">Nombre
      <input className={input} aria-label={`Nombre de la terminal ${terminal.code}`} value={draft.name} disabled={!canUpdate}
        maxLength={120} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
    <Flag label="Activa" checked={draft.isActive} disabled={!canUpdate}
      onChange={isActive => setDraft(value => ({ ...value, isActive }))} />
    {terminal.hasHistory && <span className={`text-xs ${muted}`}>Con historial: el código no cambia.</span>}
    {canUpdate && dirty && <button type="button" className={secondary} disabled={command.busy} onClick={() => void save()}>
      {command.busy ? 'Guardando…' : 'Guardar'}</button>}
    <Failure text={command.error} />
  </li>;
}

function TerminalForm({ stationId, onDone, onConflict }) {
  const [draft, setDraft] = useState({ code: '', name: '' });
  const command = useCommand(onDone, onConflict);
  const submit = async event => {
    event.preventDefault();
    const body = { stationId, code: draft.code.trim(), name: draft.name.trim() };
    if (await command.run('terminal.create', body, key => createOccTerminal(body, key), saved => `Terminal ${saved.code} creada.`))
      setDraft({ code: '', name: '' });
  };
  return <form onSubmit={submit} aria-label="Nueva terminal" className="flex flex-wrap items-end gap-3 border-t border-black/5 pt-3 dark:border-white/5">
    <label className="space-y-1 text-xs font-medium">Código
      <input className={`${input} w-28 font-mono`} required maxLength={16} value={draft.code} placeholder="C"
        onChange={event => setDraft(value => ({ ...value, code: event.target.value.toUpperCase() }))} /></label>
    <label className="min-w-48 flex-1 space-y-1 text-xs font-medium">Nombre
      <input className={input} required maxLength={120} value={draft.name} placeholder="Terminal C"
        onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} /></label>
    <button type="submit" className={primary} disabled={command.busy || !draft.code.trim() || !draft.name.trim()}>
      {command.busy ? 'Creando…' : 'Crear terminal'}</button>
    <Failure text={command.error} />
  </form>;
}

function StandRow({ stand, terminals, canUpdate, onDone, onConflict }) {
  const initial = { terminalId: stand.terminalId ?? '', code: stand.code, hasBoardingBridge: stand.hasBoardingBridge,
    isRemote: stand.isRemote, maxAircraftSize: stand.maxAircraftSize ?? null, isActive: stand.isActive };
  const [draft, setDraft] = useState(initial);
  const command = useCommand(onDone, onConflict, () => setDraft(initial));
  const dirty = Object.keys(initial).some(key => draft[key] !== initial[key]);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const save = () => {
    const body = { ...draft, expectedVersion: stand.version };
    return command.run('stand.update', { id: stand.id, ...body }, key => updateOccStand(stand.id, body, key),
      saved => (saved.isActive === stand.isActive ? `Posición ${saved.code} actualizada.`
        : saved.isActive ? `Posición ${saved.code} reactivada.` : `Posición ${saved.code} desactivada.`));
  };
  const locked = !canUpdate || stand.hasHistory;
  return <li className={`flex flex-wrap items-end gap-3 py-3 ${stand.isActive ? '' : 'opacity-70'}`}>
    <label className="space-y-1 text-xs font-medium">Código
      <input className={`${input} w-24 font-mono`} aria-label={`Código de la posición ${stand.code}`} value={draft.code}
        disabled={locked} maxLength={24} onChange={event => set('code', event.target.value.toUpperCase())} /></label>
    <label className="space-y-1 text-xs font-medium">Terminal
      <select className={`${input} w-36`} aria-label={`Terminal de la posición ${stand.code}`} value={draft.terminalId}
        disabled={locked} onChange={event => set('terminalId', event.target.value)}>
        {!draft.terminalId && <option value="">Sin terminal</option>}
        {terminals.map(terminal => <option key={terminal.id} value={terminal.id}>
          {terminal.code}{terminal.isActive ? '' : ' (inactiva)'}</option>)}
      </select></label>
    <Flag label="Puente" checked={draft.hasBoardingBridge} disabled={!canUpdate} onChange={value => set('hasBoardingBridge', value)} />
    <Flag label="Remota" checked={draft.isRemote} disabled={!canUpdate} onChange={value => set('isRemote', value)} />
    <SizeSelect label="Tamaño máximo" value={draft.maxAircraftSize} disabled={!canUpdate} onChange={value => set('maxAircraftSize', value)} />
    <Flag label="Activa" checked={draft.isActive} disabled={!canUpdate} onChange={value => set('isActive', value)} />
    {stand.hasHistory && <span className={`text-xs ${muted}`}>Con historial: el código y la terminal no cambian.</span>}
    {canUpdate && dirty && <button type="button" className={secondary} disabled={command.busy || !draft.terminalId}
      onClick={() => void save()}>{command.busy ? 'Guardando…' : 'Guardar'}</button>}
    <Failure text={command.error} />
  </li>;
}

function StandForm({ stationId, terminals, onDone, onConflict }) {
  const active = terminals.filter(terminal => terminal.isActive);
  const empty = { terminalId: active[0]?.id ?? '', code: '', hasBoardingBridge: false, isRemote: false, maxAircraftSize: null };
  const [draft, setDraft] = useState(empty);
  const command = useCommand(onDone, onConflict);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    const body = { stationId, ...draft, code: draft.code.trim() };
    if (await command.run('stand.create', body, key => createOccStand(body, key), saved => `Posición ${saved.code} creada.`))
      setDraft(current => ({ ...empty, terminalId: current.terminalId }));
  };
  if (active.length === 0) return <p className={`border-t border-black/5 pt-3 text-sm dark:border-white/5 ${muted}`}>
    Crea o reactiva una terminal para registrar sus posiciones.</p>;
  return <form onSubmit={submit} aria-label="Nueva posición" className="flex flex-wrap items-end gap-3 border-t border-black/5 pt-3 dark:border-white/5">
    <label className="space-y-1 text-xs font-medium">Terminal
      <select className={`${input} w-36`} required value={draft.terminalId} onChange={event => set('terminalId', event.target.value)}>
        {active.map(terminal => <option key={terminal.id} value={terminal.id}>{terminal.code}</option>)}
      </select></label>
    <label className="space-y-1 text-xs font-medium">Código
      <input className={`${input} w-24 font-mono`} required maxLength={24} value={draft.code} placeholder="9A"
        onChange={event => set('code', event.target.value.toUpperCase())} /></label>
    <Flag label="Puente" checked={draft.hasBoardingBridge} onChange={value => set('hasBoardingBridge', value)} />
    <Flag label="Remota" checked={draft.isRemote} onChange={value => set('isRemote', value)} />
    <SizeSelect label="Tamaño máximo" value={draft.maxAircraftSize} onChange={value => set('maxAircraftSize', value)} />
    <button type="submit" className={primary} disabled={command.busy || !draft.code.trim() || !draft.terminalId}>
      {command.busy ? 'Creando…' : 'Crear posición'}</button>
    <Failure text={command.error} />
  </form>;
}

function AircraftTypeRow({ type, canUpdate, onDone, onConflict }) {
  const initial = { iataCode: type.iataCode ?? '', manufacturer: type.manufacturer, model: type.model,
    sizeCategory: type.sizeCategory ?? null, isActive: type.isActive };
  const [draft, setDraft] = useState(initial);
  const command = useCommand(onDone, onConflict, () => setDraft(initial));
  const dirty = Object.keys(initial).some(key => draft[key] !== initial[key]);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const save = () => {
    const body = { ...draft, iataCode: draft.iataCode.trim() || null, expectedVersion: type.version };
    return command.run('aircraft_type.update', { id: type.id, ...body }, key => updateOccAircraftType(type.id, body, key),
      saved => (saved.isActive === type.isActive ? `Tipo ${saved.icaoCode} actualizado.`
        : saved.isActive ? `Tipo ${saved.icaoCode} reactivado.` : `Tipo ${saved.icaoCode} desactivado.`));
  };
  return <li className={`flex flex-wrap items-end gap-3 py-3 ${type.isActive ? '' : 'opacity-70'}`}>
    <span className="w-16 pb-3 font-mono font-semibold">{type.icaoCode}</span>
    <label className="space-y-1 text-xs font-medium">IATA
      <input className={`${input} w-20 font-mono`} aria-label={`Código IATA de ${type.icaoCode}`} value={draft.iataCode}
        disabled={!canUpdate} maxLength={3} onChange={event => set('iataCode', event.target.value.toUpperCase())} /></label>
    <label className="space-y-1 text-xs font-medium">Fabricante
      <input className={`${input} w-36`} aria-label={`Fabricante de ${type.icaoCode}`} value={draft.manufacturer}
        disabled={!canUpdate} maxLength={100} onChange={event => set('manufacturer', event.target.value)} /></label>
    <label className="min-w-36 flex-1 space-y-1 text-xs font-medium">Modelo
      <input className={input} aria-label={`Modelo de ${type.icaoCode}`} value={draft.model} disabled={!canUpdate}
        maxLength={100} onChange={event => set('model', event.target.value)} /></label>
    <SizeSelect label="Tamaño" value={draft.sizeCategory} disabled={!canUpdate} emptyLabel="Sin clasificar"
      onChange={value => set('sizeCategory', value)} />
    <Flag label="Activo" checked={draft.isActive} disabled={!canUpdate} onChange={value => set('isActive', value)} />
    {canUpdate && dirty && <button type="button" className={secondary} disabled={command.busy} onClick={() => void save()}>
      {command.busy ? 'Guardando…' : 'Guardar'}</button>}
    <Failure text={command.error} />
  </li>;
}

function AircraftTypeForm({ onDone, onConflict }) {
  const empty = { icaoCode: '', iataCode: '', manufacturer: '', model: '', sizeCategory: null };
  const [draft, setDraft] = useState(empty);
  const command = useCommand(onDone, onConflict);
  const set = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault();
    const body = { icaoCode: draft.icaoCode.trim(), iataCode: draft.iataCode.trim() || null, manufacturer: draft.manufacturer.trim(),
      model: draft.model.trim(), sizeCategory: draft.sizeCategory };
    if (await command.run('aircraft_type.create', body, key => createOccAircraftType(body, key),
      saved => `Tipo de avión ${saved.icaoCode} creado.`)) setDraft(empty);
  };
  return <form onSubmit={submit} aria-label="Nuevo tipo de avión" className="flex flex-wrap items-end gap-3 border-t border-black/5 pt-3 dark:border-white/5">
    <label className="space-y-1 text-xs font-medium">OACI
      <input className={`${input} w-24 font-mono`} required maxLength={4} value={draft.icaoCode} placeholder="B738"
        onChange={event => set('icaoCode', event.target.value.toUpperCase())} /></label>
    <label className="space-y-1 text-xs font-medium">IATA
      <input className={`${input} w-20 font-mono`} maxLength={3} value={draft.iataCode} placeholder="73H"
        onChange={event => set('iataCode', event.target.value.toUpperCase())} /></label>
    <label className="space-y-1 text-xs font-medium">Fabricante
      <input className={`${input} w-36`} required maxLength={100} value={draft.manufacturer} placeholder="Boeing"
        onChange={event => set('manufacturer', event.target.value)} /></label>
    <label className="min-w-36 flex-1 space-y-1 text-xs font-medium">Modelo
      <input className={input} required maxLength={100} value={draft.model} placeholder="737-800"
        onChange={event => set('model', event.target.value)} /></label>
    <SizeSelect label="Tamaño" value={draft.sizeCategory} emptyLabel="Sin clasificar" onChange={value => set('sizeCategory', value)} />
    <button type="submit" className={primary}
      disabled={command.busy || !draft.icaoCode.trim() || !draft.manufacturer.trim() || !draft.model.trim()}>
      {command.busy ? 'Creando…' : 'Crear tipo de avión'}</button>
    <Failure text={command.error} />
  </form>;
}

/**
 * «Datos maestros» of OCC (2-A): the terminals and stands of the station and the shared aircraft types. A code is
 * fixed once flights, coverages or shifts used it, something in use is never deactivated, and nothing is deleted.
 */
export default function MasterDataRoute() {
  const station = useOccStation();
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState({ tone: '', text: '' });
  const live = useRef(() => {});

  useEffect(() => {
    if (!station.stationId) return undefined;
    const controller = new AbortController();
    const read = () => loadOccMasterData(station.stationId, { signal: controller.signal })
      .then(data => setState({ status: 'success', data }))
      .catch(error => {
        if (error?.name === 'AbortError') return;
        setState(current => (current.data && !isForbidden(error) ? current : { status: 'error', error }));
      });
    live.current = read;
    void read();
    return () => controller.abort();
  }, [station.stationId, attempt]);

  // Another OCC seat changed the station's layout: re-read under current permissions.
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('occ_planning')) void live.current();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, []);

  const reread = useCallback(text => { setFeedback({ tone: 'danger', text }); void live.current(); }, []);
  const done = useCallback(text => { setFeedback({ tone: 'success', text }); void live.current(); }, []);

  const data = state.data;
  let body;
  if (!station.stationId) body = <p role="alert" className={card}>Tu cuenta no tiene una estación OCC autorizada.</p>;
  else if (state.status === 'loading') body = <p role="status" className={card}>Cargando los datos maestros…</p>;
  else if (state.status === 'error' && isForbidden(state.error)) body = <p role="alert" className={card}>
    Tu acceso no permite ver los datos maestros de esta estación.</p>;
  else if (state.status === 'error') body = <div role="alert" className={`${card} flex flex-wrap items-center gap-3`}>
    <p>{masterDataMessage(state.error)}</p>
    <button type="button" className={secondary} onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>;
  else {
    const props = { onDone: done, onConflict: reread };
    body = <div className="space-y-4">
      {!data.canCreate && !data.canUpdate && <p role="status" className={`${card} text-sm`}>
        Tu acceso permite consultar los datos maestros, no modificarlos.</p>}
      <section className={`${card} space-y-2`} aria-label="Terminales">
        <h2 className="text-base font-semibold">Terminales</h2>
        {data.terminals.length === 0 ? <p role="status" className={`text-sm ${muted}`}>
          La estación aún no tiene terminales. Crea la primera para registrar sus posiciones.</p> :
          <ul className="divide-y divide-black/5 dark:divide-white/5">{data.terminals.map(terminal =>
            <TerminalRow key={`${terminal.id}-${terminal.version}`} terminal={terminal} canUpdate={data.canUpdate} {...props} />)}</ul>}
        {data.canCreate && <TerminalForm stationId={data.stationId} {...props} />}
      </section>
      <section className={`${card} space-y-2`} aria-label="Posiciones">
        <h2 className="text-base font-semibold">Posiciones</h2>
        <p className={`text-xs ${muted}`}>Las posiciones activas de terminales activas aparecen en Cobertura, en el mapa y al registrar un vuelo.</p>
        {data.stands.length === 0 ? <p role="status" className={`text-sm ${muted}`}>La estación aún no tiene posiciones.</p> :
          <ul className="divide-y divide-black/5 dark:divide-white/5">{data.stands.map(stand =>
            <StandRow key={`${stand.id}-${stand.version}`} stand={stand} terminals={data.terminals} canUpdate={data.canUpdate} {...props} />)}</ul>}
        {data.canCreate && <StandForm key={data.terminals.map(item => `${item.id}${item.isActive}`).join()} stationId={data.stationId}
          terminals={data.terminals} {...props} />}
      </section>
      <section className={`${card} space-y-2`} aria-label="Tipos de avión">
        <h2 className="text-base font-semibold">Tipos de avión</h2>
        <p className={`text-xs ${muted}`}>Compartidos por todas las estaciones. El tamaño decide qué posiciones admite cada vuelo.</p>
        {data.aircraftTypes.length === 0 ? <p role="status" className={`text-sm ${muted}`}>Aún no hay tipos de avión.</p> :
          <ul className="divide-y divide-black/5 dark:divide-white/5">{data.aircraftTypes.map(type =>
            <AircraftTypeRow key={`${type.id}-${type.version}`} type={type} canUpdate={data.canUpdate} {...props} />)}</ul>}
        {data.canCreate && <AircraftTypeForm {...props} />}
      </section>
    </div>;
  }

  return (
    <section className="space-y-4">
      <header data-occ-header className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div><h1 className="text-xl font-semibold">Datos maestros</h1>
          <p className={`text-sm ${muted}`}>Terminales, posiciones y tipos de avión de la estación. Nada se borra: lo que deja de usarse se desactiva.</p></div>
        <OccStationBadge />
      </header>
      {feedback.text && (feedback.tone === 'danger'
        ? <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{feedback.text}</p>
        : <p role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{feedback.text}</p>)}
      {body}
    </section>
  );
}
