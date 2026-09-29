import { useEffect, useRef, useState } from 'react';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { getHumanResourcesPermits, recordHumanResourcesPermit } from
  '../../../services/humanResourcesPermitsReadService';

const DOCUMENT_TYPES = [
  ['AirportId', 'Carnet aeroportuario'],
  ['RampDriverLicense', 'Licencia de conducir en rampa'],
];

export default function PermitRecordForm({ initialPermit, onRecorded, onClose, onDenied }) {
  const [rampProfileId, setRampProfileId] = useState(initialPermit?.rampProfileId ?? '');
  const [documentType, setDocumentType] = useState(initialPermit?.documentType ?? '');
  const [fields, setFields] = useState({ documentNumber: '', issuedOn: '', expiresOn: '' });
  const [catalog, setCatalog] = useState({ status: 'loading', profiles: [] });
  const [lookup, setLookup] = useState({ status: 'idle', current: null });
  const [lookupRevision, setLookupRevision] = useState(0);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let active = true;
    getRampProfiles()
      .then(result => {
        if (active) setCatalog({ status: 'ready',
          profiles: result.profiles.filter(profile => profile.isActive) });
      })
      .catch(failure => {
        if (!active) return;
        if (failure?.status === 401 || failure?.status === 403) onDenied(failure.status);
        else setCatalog({ status: 'error', profiles: [] });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!rampProfileId || !documentType) {
      setLookup({ status: 'idle', current: null });
      return undefined;
    }
    const controller = new AbortController();
    setLookup({ status: 'loading', current: null });
    getHumanResourcesPermits({ page: 1, limit: 1, rampProfileId, documentType },
      { signal: controller.signal })
      .then(page => {
        if (!controller.signal.aborted)
          setLookup({ status: 'ready', current: page.permits[0] ?? null,
            rampProfileId, documentType });
      })
      .catch(failure => {
        if (controller.signal.aborted || failure?.name === 'AbortError') return;
        if (failure?.status === 401 || failure?.status === 403) onDenied(failure.status);
        else setLookup({ status: 'error', current: null });
      });
    return () => controller.abort();
  }, [rampProfileId, documentType, lookupRevision]);

  function changeSelection(name, value) {
    if (name === 'agent') setRampProfileId(value);
    else setDocumentType(value);
    setPending(null);
    setError('');
  }

  function changeField(name, value) {
    setFields(previous => ({ ...previous, [name]: value }));
    setPending(null);
    setError('');
  }

  async function submitRecord() {
    if (busy || catalog.status !== 'ready' || lookup.status !== 'ready' ||
        lookup.rampProfileId !== rampProfileId || lookup.documentType !== documentType) return;
    if (!fields.documentNumber.trim() || fields.documentNumber.trim().length < 2 ||
        fields.documentNumber.trim().length > 64 || !fields.issuedOn || !fields.expiresOn ||
        fields.issuedOn > today || fields.issuedOn > fields.expiresOn) {
      setError('Revisa el número y las fechas: emisión no futura y vencimiento posterior.');
      return;
    }
    const request = { rampProfileId, documentType,
      expectedCurrentId: lookup.current?.id ?? null, ...fields };
    const intent = pending ?? { id: crypto.randomUUID(), request };
    setPending(intent);
    setBusy(true);
    setError('');
    try {
      const receipt = await recordHumanResourcesPermit(intent.id, intent.request);
      if (!mounted.current) return;
      setPending(null);
      onRecorded(receipt);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure?.status === 409) {
        setPending(null);
        setLookup({ status: 'loading', current: null });
        setLookupRevision(value => value + 1);
        setError('El ciclo cambió mientras editabas. Revisamos el registro actual; confirma antes de guardar de nuevo.');
      } else if (failure?.status === 401 || failure?.status === 403) {
        setPending(null);
        onDenied(failure.status);
      } else if (failure?.status === 400 || failure?.status === 404) {
        setPending(null);
        setLookup({ status: 'loading', current: null });
        setLookupRevision(value => value + 1);
        setError('No se pudo guardar. Revisa las fechas y que el agente siga activo.');
      } else {
        setError('No pudimos confirmar el resultado. Reintenta el mismo registro sin modificarlo para evitar duplicados.');
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const canSubmit = catalog.status === 'ready' && lookup.status === 'ready' &&
    lookup.rampProfileId === rampProfileId && lookup.documentType === documentType &&
    !!rampProfileId && !!documentType && !busy;
  return <section className="rounded-2xl border border-accent-600/20 bg-white p-5 shadow-sm dark:bg-surface-dark-card">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">Registrar carnet o permiso</h2>
      <button type="button" disabled={busy} onClick={onClose}
        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Cerrar</button>
    </div>
    {catalog.status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando agentes…</p>}
    {catalog.status === 'error' && <p role="alert" className="mt-3 text-sm text-status-danger">
      No se pudieron cargar los agentes. Cierra y vuelve a intentarlo.
    </p>}
    {catalog.status === 'ready' && <form className="mt-4 grid gap-4 md:grid-cols-2"
      onSubmit={event => { event.preventDefault(); void submitRecord(); }}>
      <label className="text-sm font-semibold">Agente de rampa
        <select required value={rampProfileId}
          onChange={event => changeSelection('agent', event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona un agente</option>
          {catalog.profiles.map(profile => <option key={profile.id} value={profile.id}>
            {profile.employeeNumber} · {profile.firstName} {profile.lastName}
          </option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Tipo de documento
        <select required value={documentType}
          onChange={event => changeSelection('documentType', event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona un tipo</option>
          {DOCUMENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {lookup.status === 'loading' && <p role="status" className="md:col-span-2 text-sm">Consultando el ciclo actual…</p>}
      {lookup.status === 'error' && <p role="alert" className="md:col-span-2 text-sm text-status-danger">
        No se pudo consultar el ciclo actual. No es seguro registrar sin volver a cargarlo.
        <button type="button" onClick={() => setLookupRevision(value => value + 1)}
          className="ml-2 underline">Reintentar consulta</button>
      </p>}
      {lookup.status === 'ready' && <p className="md:col-span-2 rounded-lg bg-accent-600/5 p-3 text-sm">
        {lookup.current ? `Renovará el ciclo ${lookup.current.cycleNumber} de ${lookup.current.agentName}.`
          : 'Primer ciclo para este agente y documento.'}
      </p>}
      <label className="text-sm font-semibold">Número de documento
        <input required minLength={2} maxLength={64} value={fields.documentNumber}
          onChange={event => changeField('documentNumber', event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      {[['issuedOn', 'Fecha de emisión'], ['expiresOn', 'Fecha de vencimiento']].map(([name, label]) =>
        <label key={name} className="text-sm font-semibold">{label}
          <input required type="date" max={name === 'issuedOn' ? today : undefined}
            value={fields[name]} onChange={event => changeField(name, event.target.value)}
            className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
        </label>)}
      {error && <p role="alert" className="md:col-span-2 text-sm text-status-danger">{error}</p>}
      <div className="md:col-span-2 flex gap-3">
        <button type="submit" disabled={!canSubmit}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? 'Guardando…' : lookup.current ? 'Guardar renovación' : 'Registrar permiso'}
        </button>
        {pending && error.startsWith('No pudimos confirmar') && <button type="button"
          disabled={busy} onClick={() => void submitRecord()}
          className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Reintentar el mismo registro</button>}
      </div>
    </form>}
  </section>;
}
