import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppLink from '../../components/AppLink';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { OccStationBadge } from '../admin-occ/OccQueueState';
import { useOccStation } from '../admin-occ/useOccStation';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { isConflict } from '../../services/problemMessages';
import { stationDate } from '../../services/positionsMapService';
import {
  addOccStandConstraint, createOccCoverage, describeReasons, loadOccCoverage, releaseOccCoverage,
  removeOccStandConstraint, updateOccStandAttributes, updateOccTerminalRules,
} from '../../services/occCoverageService';

const card = 'rounded-2xl border border-black/5 bg-white/80 p-5 dark:border-white/5 dark:bg-surface-dark-card';
const muted = 'text-text-secondary-light dark:text-text-secondary-dark';
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold disabled:opacity-50';
const primary = `${button} bg-accent-600 text-white`;
const secondary = `${button} border border-accent-600/40 text-accent-600`;
const input = 'min-h-11 w-full rounded-lg border border-black/10 bg-white px-3 text-sm dark:border-white/10 dark:bg-surface-dark';
const TIME = new Intl.DateTimeFormat('es-DO', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Santo_Domingo' });
const time = value => TIME.format(new Date(value));
const KINDS = { Cancels: 'anula', NarrowbodyOnly: 'limita a estrecho' };
const SIZES = { Narrowbody: 'Solo estrecho', Widebody: 'Hasta ancho' };

function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-black/5 dark:bg-white/10',
    accent: 'bg-accent-600/10 text-accent-600',
    warning: 'bg-status-warning/15 text-status-warning',
    danger: 'bg-status-danger/10 text-status-danger',
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

function Reasons({ error }) {
  if (!error) return null;
  const reasons = describeReasons(error.reasons);
  return (
    <div role="alert" className="rounded-xl border border-status-danger/30 bg-status-danger/5 p-3 text-sm">
      <p className="font-semibold text-status-danger">{error.message}</p>
      {reasons.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5">{reasons.map(text => <li key={text}>{text}</li>)}</ul>}
    </div>
  );
}

/**
 * Form to hand an agent their stands for the shift; the server applies Pillier's rules. One intent keeps its
 * Idempotency-Key while OCC retries the same coverage after an uncertain answer (3-J), so a lost answer never turns
 * into «El agente ya cubre posiciones en ese horario».
 */
function CoverageForm({ board, terminal, date, onDone, onStale }) {
  const agents = board.agents.filter(agent => agent.terminalId === terminal.terminalId || terminal.code === 'B');
  const stands = board.stands.filter(stand => stand.terminalId === terminal.terminalId && stand.isActive);
  const [agentId, setAgentId] = useState('');
  const [selected, setSelected] = useState([]);
  const [mentorId, setMentorId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [reinforcement, setReinforcement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const creation = useRef(createCommandKeyHolder());
  const agent = board.agents.find(item => item.agentId === agentId);
  const mentors = board.agents.filter(item => !item.isJunior && item.agentId !== agentId);
  const toggle = id => setSelected(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const command = { stationId: board.stationId, date, agentId, terminalId: terminal.terminalId, standIds: selected,
      mentorAgentId: mentorId || null, vehicleCode: vehicle.trim() || null, isReinforcement: reinforcement };
    try {
      const result = await creation.current.run('create', command,
        key => createOccCoverage(command, { idempotencyKey: key }));
      setSelected([]); setMentorId(''); setVehicle(''); setReinforcement(false); setAgentId('');
      onDone(result);
    } catch (failure) {
      setError(failure);
      // The board changed meanwhile: it is read again before a new intent.
      if (failure?.status === 409) onStale?.();
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className={`${card} space-y-4`} aria-label="Asignar posiciones">
      <div>
        <h2 className="text-base font-semibold">Asignar posiciones · Terminal {terminal.code}</h2>
        <p className={`text-xs ${muted}`}>Máximo {terminal.maxStandsPerAgent} por agente
          {terminal.requiresBridgeQualification ? ' · exige habilitación de puente' : ''}. El horario es el turno completo del agente.</p>
      </div>
      <label className="block space-y-1 text-sm font-medium">Agente
        <select className={input} value={agentId} onChange={event => setAgentId(event.target.value)} required>
          <option value="">Elige un agente con turno</option>
          {agents.map(item => <option key={item.agentId} value={item.agentId}>
            {item.name} · {time(item.shiftStartsAt)}–{time(item.shiftEndsAt)}{item.isJunior ? ' · menos de 3 meses' : ''}</option>)}
        </select>
      </label>
      {agent && <div className="flex flex-wrap gap-1.5">
        {agent.isJunior && <Badge tone="warning">Menos de 3 meses: va con mentor</Badge>}
        <Badge tone={agent.hasDriverLicense ? 'accent' : 'neutral'}>{agent.hasDriverLicense ? 'Licencia de conducir' : 'Sin licencia de conducir'}</Badge>
        <Badge tone={agent.hasBridgeQualification ? 'accent' : 'neutral'}>{agent.hasBridgeQualification ? 'Habilitado en puente' : 'Sin habilitación de puente'}</Badge>
        {!agent.hasAirportPermit && <Badge tone="danger">Carnet aeroportuario vencido</Badge>}
        {agent.isAbsent && <Badge tone="danger">Ausencia aprobada</Badge>}
      </div>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Posiciones ({selected.length}/{terminal.maxStandsPerAgent})</legend>
        {stands.length === 0 ? <p className={`text-sm ${muted}`}>Esta terminal no tiene posiciones activas.</p> :
          <div className="flex flex-wrap gap-2">{stands.map(stand => {
            const on = selected.includes(stand.standId);
            return <button key={stand.standId} type="button" aria-pressed={on} onClick={() => toggle(stand.standId)}
              className={`min-h-11 min-w-16 rounded-lg border px-3 text-sm font-semibold ${on ? 'border-accent-600 bg-accent-600 text-white'
                : 'border-black/10 dark:border-white/10'}`}>
              {stand.code}{stand.hasBoardingBridge ? ' ⌁' : ''}</button>;
          })}</div>}
      </fieldset>
      {(agent?.isJunior || mentorId) && <label className="block space-y-1 text-sm font-medium">Mentor
        <select className={input} value={mentorId} onChange={event => setMentorId(event.target.value)}>
          <option value="">Sin mentor</option>
          {/* 2-N23: a mentor who is absent or without a current airport permit cannot accompany anyone. */}
          {mentors.map(item => <option key={item.agentId} value={item.agentId}
            disabled={item.isAbsent || !item.hasAirportPermit}>
            {item.name}{item.isAbsent ? ' · ausencia aprobada' : ''}{!item.hasAirportPermit ? ' · carnet vencido' : ''}</option>)}
        </select>
      </label>}
      {selected.length > 2 && <label className="block space-y-1 text-sm font-medium">Vehículo asignado
        <input className={input} value={vehicle} maxLength={32} onChange={event => setVehicle(event.target.value)}
          placeholder="Ej. VH-07" />
      </label>}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={reinforcement} onChange={event => setReinforcement(event.target.checked)} />
        Refuerzo (segundo agente en posiciones ya cubiertas, p. ej. sábados de 12:00 a 17:00)
      </label>
      <Reasons error={error} />
      <button type="submit" className={primary} disabled={busy || !agentId || selected.length === 0}>
        {busy ? 'Guardando…' : 'Asignar posiciones'}</button>
    </form>
  );
}

function CoverageBoard({ board, terminal, date, onChange, onStale }) {
  const [error, setError] = useState(null);
  const releases = useRef(createCommandKeyHolder());
  const coverages = board.coverages.filter(item => item.terminalId === terminal.terminalId);
  const stands = board.stands.filter(stand => stand.terminalId === terminal.terminalId);
  // A release retried after an uncertain answer keeps its key and answers the board again (3-J).
  const release = async coverage => {
    setError(null);
    try {
      onChange(await releases.current.run('release', [coverage.id, date],
        key => releaseOccCoverage(coverage.id, date, { idempotencyKey: key })));
    } catch (failure) {
      setError(failure);
      if (failure?.status === 409) onStale?.();
    }
  };
  return (
    <div className="space-y-4">
      <section className={card} aria-label="Posiciones de la terminal">
        <h2 className="mb-3 text-base font-semibold">Posiciones · Terminal {terminal.code}</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {stands.map(stand => <li key={stand.standId} data-stand={stand.code}
            className={`rounded-xl border p-3 ${stand.coveredBy.length ? 'border-accent-600/40 bg-accent-600/5' : 'border-black/10 dark:border-white/10'}
              ${stand.isActive ? '' : 'opacity-50'}`}>
            <p className="flex items-center justify-between font-mono text-sm font-semibold">{stand.code}
              <span className="flex gap-1">{stand.hasBoardingBridge && <Badge>Puente</Badge>}
                {stand.maxAircraftSize === 'Narrowbody' && <Badge tone="warning">Estrecho</Badge>}</span></p>
            <p className={`mt-1 truncate text-xs ${stand.coveredBy.length ? '' : muted}`}>
              {stand.isActive ? (stand.coveredBy.join(', ') || 'Sin agente') : 'Desactivada'}</p>
          </li>)}
        </ul>
      </section>
      <section className={card} aria-label="Coberturas del día">
        <h2 className="mb-3 text-base font-semibold">Coberturas del día</h2>
        <Reasons error={error} />
        {coverages.length === 0 ? <p className={`text-sm ${muted}`}>Aún no hay agentes asignados en esta terminal.</p> :
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {coverages.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">{item.agentName}
                  {item.isReinforcement && <span className="ml-2"><Badge tone="warning">Refuerzo</Badge></span>}</p>
                <p className={`text-xs ${muted}`}>{item.stands.map(stand => stand.code).join(' · ')} · {time(item.startsAt)}–{time(item.endsAt)}
                  {item.mentorName ? ` · mentor ${item.mentorName}` : ''}{item.vehicleCode ? ` · vehículo ${item.vehicleCode}` : ''}</p>
              </div>
              {board.canAssign && <button type="button" className={secondary} onClick={() => void release(item)}>Liberar</button>}
            </li>)}
          </ul>}
      </section>
    </div>
  );
}

/**
 * One stand's attributes (2-A). The change carries the stand's version on the board, the one «Datos maestros» shows,
 * and the intent's key: a retry after no answer replays the first result. A stand changed meanwhile, here or in «Datos
 * maestros», reads the board again; the row's error lives in the parent so it survives that re-read.
 */
function StandRow({ stand, date, error, onError, onChange, onStale }) {
  const [draft, setDraft] = useState(stand);
  const keys = useRef(createCommandKeyHolder());
  const dirty = ['hasBoardingBridge', 'isRemote', 'maxAircraftSize', 'isActive'].some(key => draft[key] !== stand[key]);
  const save = async () => {
    onError(null);
    const attributes = { date, hasBoardingBridge: draft.hasBoardingBridge, isRemote: draft.isRemote,
      maxAircraftSize: draft.maxAircraftSize ?? null, isActive: draft.isActive, expectedVersion: stand.version };
    try {
      onChange(await keys.current.run('stand-attributes', attributes,
        key => updateOccStandAttributes(stand.standId, attributes, key)));
    } catch (failure) {
      onError(failure);
      if (isConflict(failure)) onStale();
    }
  };
  const flag = (key, label) => <label className="flex items-center gap-1.5 text-xs">
    <input type="checkbox" checked={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: event.target.checked }))} />{label}</label>;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <span className="w-16 font-mono font-semibold">{stand.code}</span>
      {flag('hasBoardingBridge', 'Puente')}{flag('isRemote', 'Remota')}{flag('isActive', 'Activa')}
      <select aria-label={`Tamaño máximo de ${stand.code}`} className={`${input} w-40`} value={draft.maxAircraftSize ?? ''}
        onChange={event => setDraft(value => ({ ...value, maxAircraftSize: event.target.value || null }))}>
        <option value="">Cualquier tamaño</option>
        {Object.entries(SIZES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      {dirty && <button type="button" className={secondary} onClick={() => void save()}>Guardar</button>}
      {error && <span role="alert" className="text-xs text-status-danger">{error.message}</span>}
    </li>
  );
}

/** OCC loads the real PUJ layout here: stand attributes, terminal limits and combined stands. */
function Configuration({ board, terminal, date, onChange, onStale }) {
  const access = useOptionalDepartmentAccess();
  const [max, setMax] = useState(String(terminal.maxStandsPerAgent));
  const [bridge, setBridge] = useState(terminal.requiresBridgeQualification);
  const [rule, setRule] = useState({ standId: '', kind: 'Cancels', affectedStandId: '' });
  const [error, setError] = useState(null);
  const [standErrors, setStandErrors] = useState({});
  const stands = board.stands.filter(stand => stand.terminalId === terminal.terminalId);
  const run = async action => { setError(null); try { onChange(await action()); } catch (failure) { setError(failure); } };
  return (
    <div className="space-y-4">
      <section className={`${card} space-y-3`} aria-label="Reglas de la terminal">
        <h2 className="text-base font-semibold">Reglas de la Terminal {terminal.code}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium">Máximo de posiciones por agente
            <input className={`${input} w-28`} type="number" min={1} max={6} value={max} onChange={event => setMax(event.target.value)} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={bridge} onChange={event => setBridge(event.target.checked)} />Exige habilitación de puente</label>
          <button type="button" className={secondary} onClick={() => void run(() => updateOccTerminalRules(terminal.terminalId,
            { date, maxStandsPerAgent: Number(max), requiresBridgeQualification: bridge }))}>Guardar reglas</button>
        </div>
      </section>
      <section className={card} aria-label="Atributos de las posiciones">
        <h2 className="text-base font-semibold">Posiciones</h2>
        <p className={`text-xs ${muted}`}>Marca las posiciones con puente, las remotas y el tamaño máximo de avión que admiten.</p>
        {access?.can('operations.master_data.read') && <p className={`text-xs ${muted}`}>Las terminales y las posiciones nuevas
          se crean, renombran o desactivan en <AppLink href="/admin-occ/master-data" className="font-semibold text-accent-600 underline">Datos maestros</AppLink>.</p>}
        <ul className="divide-y divide-black/5 dark:divide-white/5">
          {/* A new version on the board (a change here or in «Datos maestros») starts the row again from it. */}
          {stands.map(stand => <StandRow key={`${stand.standId}-${stand.version}-${stand.hasBoardingBridge}-${stand.isRemote}-${stand.maxAircraftSize}-${stand.isActive}`}
            stand={stand} date={date} onChange={onChange} onStale={onStale} error={standErrors[stand.standId] ?? null}
            onError={failure => setStandErrors(all => ({ ...all, [stand.standId]: failure }))} />)}
        </ul>
      </section>
      <section className={`${card} space-y-3`} aria-label="Posiciones combinadas">
        <h2 className="text-base font-semibold">Posiciones combinadas</h2>
        <p className={`text-xs ${muted}`}>Las fija el aeropuerto: «9A anula la 10», «23A limita la 25 a estrecho». Se avisa a OCC en el mapa.</p>
        <ul className="space-y-1">{board.constraints.map(item => <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
          <span><strong className="font-mono">{item.standCode}</strong> {KINDS[item.kind]} <strong className="font-mono">{item.affectedStandCode}</strong></span>
          <button type="button" className="text-xs font-semibold text-status-danger underline"
            onClick={() => void run(() => removeOccStandConstraint(item.id, date))}>Quitar</button></li>)}</ul>
        <div className="flex flex-wrap items-end gap-2">
          {[['standId', 'Si se ocupa'], ['affectedStandId', 'entonces']].map(([key, label]) => <label key={key} className="space-y-1 text-sm font-medium">{label}
            <select className={`${input} w-32`} value={rule[key]} onChange={event => setRule(value => ({ ...value, [key]: event.target.value }))}>
              <option value="">—</option>{board.stands.map(stand => <option key={stand.standId} value={stand.standId}>{stand.code}</option>)}
            </select></label>)}
          <label className="space-y-1 text-sm font-medium">Efecto
            <select className={`${input} w-44`} value={rule.kind} onChange={event => setRule(value => ({ ...value, kind: event.target.value }))}>
              <option value="Cancels">queda anulada</option><option value="NarrowbodyOnly">solo admite estrecho</option>
            </select></label>
          <button type="button" className={secondary} disabled={!rule.standId || !rule.affectedStandId || rule.standId === rule.affectedStandId}
            onClick={() => void run(() => addOccStandConstraint({ date, ...rule }))}>Añadir regla</button>
        </div>
      </section>
      <Reasons error={error} />
    </div>
  );
}

/**
 * «Cobertura de posiciones» (ADR-0030): which agent covers which stands during their shift, with
 * the rules OCC applies today (Pillier) checked by the API, and the stand configuration of PUJ.
 */
export default function CoverageRoute() {
  const station = useOccStation();
  const [date, setDate] = useState(() => stationDate());
  const [state, setState] = useState({ status: 'loading' });
  const [terminalCode, setTerminalCode] = useState('A');
  const [tab, setTab] = useState('coverage');
  const [attempt, setAttempt] = useState(0);
  const live = useRef(() => {});

  useEffect(() => {
    if (!station.stationId || !date) return undefined;
    const controller = new AbortController();
    const read = () => loadOccCoverage(station.stationId, date, { signal: controller.signal })
      .then(board => setState({ status: 'success', board }))
      .catch(error => {
        if (error?.name === 'AbortError') return;
        // Without access the view says so and offers no retry; another failure keeps the board on screen.
        setState(value => error?.status === 403 ? { status: 'forbidden' }
          : value.board ? value : { status: 'error', error });
      });
    live.current = read;
    void read();
    return () => controller.abort();
  }, [station.stationId, date, attempt]);

  // Another OCC seat, HR or the airport changes something: re-read under current permissions.
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('occ_planning')) void live.current();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, []);

  const board = state.board;
  const terminal = useMemo(() => board?.terminals.find(item => item.code === terminalCode) ?? board?.terminals[0],
    [board, terminalCode]);
  const onChange = useCallback(next => setState({ status: 'success', board: next }), []);
  // A refused change because the data moved meanwhile reads the board again before a new attempt.
  const onStale = useCallback(() => { void live.current(); }, []);

  let body;
  if (!station.stationId) body = <p role="alert" className={card}>Tu cuenta no tiene una estación OCC autorizada.</p>;
  else if (state.status === 'loading') body = <p role="status" className={card}>Cargando la cobertura de posiciones…</p>;
  else if (state.status === 'forbidden') body = <p role="alert" className={card}>Tu acceso no permite ver la cobertura de posiciones de esta estación.</p>;
  else if (state.status === 'error') body = <div role="alert" className={`${card} flex flex-wrap items-center gap-3`}>
    <p>{state.error?.message}</p><button type="button" className={secondary} onClick={() => setAttempt(value => value + 1)}>Reintentar</button></div>;
  else if (!terminal) body = <p role="status" className={card}>La estación no tiene terminales activas. OCC las crea en «Datos maestros».</p>;
  else if (tab === 'configuration') body = <Configuration key={`${terminal.terminalId}-${terminal.maxStandsPerAgent}-${terminal.requiresBridgeQualification}`}
    board={board} terminal={terminal} date={date} onChange={onChange} onStale={onStale} />;
  else body = <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
    <CoverageBoard board={board} terminal={terminal} date={date} onChange={onChange} onStale={onStale} />
    {board.canAssign ? <CoverageForm key={terminal.terminalId} board={board} terminal={terminal} date={date} onDone={onChange}
      onStale={onStale} />
      : <p className={card}>Tu acceso permite ver la cobertura, no asignarla.</p>}
  </div>;

  return (
    <section className="space-y-4">
      <header data-occ-header className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div><h1 className="text-xl font-semibold">Cobertura de posiciones</h1>
          <p className={`text-sm ${muted}`}>Qué agente cubre cada posición durante su turno. Los vuelos que bloquean en esas posiciones le llegan solos.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm font-medium">Fecha <input type="date" className={`${input} ml-1 w-auto`} value={date}
            onChange={event => setDate(event.target.value)} /></label>
          <OccStationBadge />
        </div>
      </header>
      {board && <nav className="flex flex-wrap items-center gap-2" aria-label="Terminal y vista">
        {board.terminals.map(item => <button key={item.terminalId} type="button" aria-pressed={item.terminalId === terminal?.terminalId}
          onClick={() => setTerminalCode(item.code)}
          className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${item.terminalId === terminal?.terminalId ? 'bg-accent-600 text-white' : 'border border-black/10 dark:border-white/10'}`}>
          Terminal {item.code}</button>)}
        <span className="mx-2 h-6 w-px bg-black/10 dark:bg-white/10" aria-hidden="true" />
        <button type="button" aria-pressed={tab === 'coverage'} onClick={() => setTab('coverage')}
          className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${tab === 'coverage' ? 'bg-black/5 dark:bg-white/10' : ''}`}>Cobertura</button>
        {board.canConfigure && <button type="button" aria-pressed={tab === 'configuration'} onClick={() => setTab('configuration')}
          className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${tab === 'configuration' ? 'bg-black/5 dark:bg-white/10' : ''}`}>Configuración</button>}
      </nav>}
      {body}
    </section>
  );
}
