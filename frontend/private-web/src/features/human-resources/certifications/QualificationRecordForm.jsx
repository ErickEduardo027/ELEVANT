import { useEffect, useState } from 'react';
import { businessToday } from '../../../services/businessDay';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { getHumanResourcesQualificationEquipmentTypes, getHumanResourcesQualifications,
  recordHumanResourcesQualification } from '../../../services/humanResourcesQualificationsReadService';

const blankFields = () => ({ trainingDate: '', obtainedOn: '', expiresOn: '',
  certifyingEntity: '', instructorName: '', notes: '' });

export default function QualificationRecordForm({ initialQualification, onRecorded, onClose, onDenied }) {
  const [rampProfileId, setRampProfileId] = useState(initialQualification?.rampProfileId ?? '');
  const [equipmentTypeId, setEquipmentTypeId] = useState(initialQualification?.equipmentTypeId ?? '');
  const [fields, setFields] = useState(blankFields);
  const [catalog, setCatalog] = useState({ status: 'loading', profiles: [], equipment: [] });
  const [lookup, setLookup] = useState({ status: 'idle', current: null });
  const [lookupRevision, setLookupRevision] = useState(0);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // AVIAM's business day, like the server validates it (2-N31).
  const today = businessToday();

  useEffect(() => {
    let active = true;
    Promise.all([getRampProfiles(), getHumanResourcesQualificationEquipmentTypes()])
      .then(([profiles, equipment]) => {
        if (!active) return;
        setCatalog({ status: 'ready', profiles: profiles.profiles.filter(profile => profile.isActive),
          equipment });
      })
      .catch(failure => {
        if (!active) return;
        if (failure?.status === 401 || failure?.status === 403) onDenied(failure.status);
        else setCatalog({ status: 'error', profiles: [], equipment: [] });
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!rampProfileId || !equipmentTypeId) {
      setLookup({ status: 'idle', current: null });
      return undefined;
    }
    const controller = new AbortController();
    setLookup({ status: 'loading', current: null });
    getHumanResourcesQualifications({ page: 1, limit: 1, rampProfileId, equipmentTypeId },
      { signal: controller.signal })
      .then(page => {
        if (!controller.signal.aborted)
          setLookup({ status: 'ready', current: page.qualifications[0] ?? null,
            rampProfileId, equipmentTypeId });
      })
      .catch(failure => {
        if (controller.signal.aborted) return;
        if (failure?.status === 401 || failure?.status === 403) onDenied(failure.status);
        else setLookup({ status: 'error', current: null });
      });
    return () => controller.abort();
  }, [rampProfileId, equipmentTypeId, lookupRevision]);

  function updateField(name, value) {
    setFields(current => ({ ...current, [name]: value }));
    setPending(null);
    setError('');
  }

  function updateSelection(name, value) {
    if (name === 'agent') setRampProfileId(value);
    else setEquipmentTypeId(value);
    setPending(null);
    setError('');
  }

  async function submitRecord() {
    if (busy || catalog.status !== 'ready' || lookup.status !== 'ready' ||
        lookup.rampProfileId !== rampProfileId || lookup.equipmentTypeId !== equipmentTypeId) return;
    if (!fields.trainingDate || !fields.obtainedOn || !fields.expiresOn ||
        fields.trainingDate > fields.obtainedOn || fields.obtainedOn > fields.expiresOn ||
        fields.obtainedOn > today) {
      setError('Revisa las fechas: formación ≤ obtención ≤ vencimiento y obtención no futura.');
      return;
    }
    const request = { rampProfileId, equipmentTypeId,
      expectedCurrentId: lookup.current?.id ?? null, ...fields };
    const intent = pending ?? { id: crypto.randomUUID(), request };
    setPending(intent);
    setBusy(true);
    setError('');
    try {
      const receipt = await recordHumanResourcesQualification(intent.id, intent.request);
      setPending(null);
      onRecorded(receipt);
    } catch (failure) {
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
        setError('No se pudo guardar. Revisa las fechas y que el agente y equipo sigan activos.');
      } else {
        setError('No pudimos confirmar el resultado. Reintenta el mismo registro sin modificarlo para evitar duplicados.');
      }
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = catalog.status === 'ready' && lookup.status === 'ready' &&
    lookup.rampProfileId === rampProfileId && lookup.equipmentTypeId === equipmentTypeId &&
    !!rampProfileId && !!equipmentTypeId && !busy;
  return <section className="rounded-2xl border border-accent-600/20 bg-white p-5 shadow-sm dark:bg-surface-dark-card">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">Registrar habilitación de equipo</h2>
      <button type="button" disabled={busy} onClick={onClose}
        className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40">Cerrar</button>
    </div>
    {catalog.status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando agentes y equipos…</p>}
    {catalog.status === 'error' && <p role="alert" className="mt-3 text-sm text-status-danger">
      No se pudieron cargar los agentes y equipos. Cierra y vuelve a intentarlo.
    </p>}
    {catalog.status === 'ready' && <form className="mt-4 grid gap-4 md:grid-cols-2"
      onSubmit={event => { event.preventDefault(); void submitRecord(); }}>
      <label className="text-sm font-semibold">Agente de rampa
        <select required value={rampProfileId} onChange={event => updateSelection('agent', event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona un agente</option>
          {catalog.profiles.map(profile => <option key={profile.id} value={profile.id}>
            {profile.employeeNumber} · {profile.firstName} {profile.lastName}
          </option>)}
        </select>
      </label>
      <label className="text-sm font-semibold">Equipo
        <select required value={equipmentTypeId} onChange={event => updateSelection('equipment', event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark">
          <option value="">Selecciona un equipo</option>
          {catalog.equipment.map(item => <option key={item.id} value={item.id}>
            {item.code} · {item.name}
          </option>)}
        </select>
      </label>
      {lookup.status === 'loading' && <p role="status" className="md:col-span-2 text-sm">Consultando el ciclo actual…</p>}
      {lookup.status === 'error' && <p role="alert" className="md:col-span-2 text-sm text-status-danger">
        No se pudo consultar el ciclo actual. No es seguro registrar sin volver a cargarlo.
        <button type="button" onClick={() => setLookupRevision(value => value + 1)}
          className="ml-2 underline">Reintentar consulta</button>
      </p>}
      {lookup.status === 'ready' && <p className="md:col-span-2 rounded-lg bg-accent-600/5 p-3 text-sm">
        {lookup.current ? `Renovará el ciclo ${lookup.current.cycleNumber} de ${lookup.current.agentName} para ${lookup.current.equipmentName}.`
          : 'Primer ciclo para este agente y equipo.'}
      </p>}
      {[['trainingDate', 'Fecha de formación'], ['obtainedOn', 'Fecha de obtención'],
        ['expiresOn', 'Fecha de vencimiento']].map(([name, label]) =>
        <label key={name} className="text-sm font-semibold">{label}
          <input required type="date" max={name === 'obtainedOn' ? today : undefined}
            value={fields[name]} onChange={event => updateField(name, event.target.value)}
            className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
        </label>)}
      {[['certifyingEntity', 'Entidad certificadora'], ['instructorName', 'Instructor']].map(([name, label]) =>
        <label key={name} className="text-sm font-semibold">{label}
          <input required minLength={2} maxLength={160} value={fields[name]}
            onChange={event => updateField(name, event.target.value)}
            className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
        </label>)}
      <label className="md:col-span-2 text-sm font-semibold">Notas (opcional)
        <textarea maxLength={1000} value={fields.notes}
          onChange={event => updateField('notes', event.target.value)}
          className="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" />
      </label>
      {error && <p role="alert" className="md:col-span-2 text-sm text-status-danger">{error}</p>}
      <div className="md:col-span-2 flex gap-3">
        <button type="submit" disabled={!canSubmit}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? 'Guardando…' : lookup.current ? 'Guardar renovación' : 'Registrar habilitación'}
        </button>
        {pending && error.startsWith('No pudimos confirmar') && <button type="button"
          disabled={busy} onClick={() => void submitRecord()}
          className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40">
          Reintentar el mismo registro</button>}
      </div>
    </form>}
  </section>;
}
