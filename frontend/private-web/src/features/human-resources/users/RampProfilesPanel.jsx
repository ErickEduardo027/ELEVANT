import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getRampProfiles, listRampMobileAccessRequests, requestRampMobileAccess,
  saveRampProfile, uploadCommercialMedia } from '../../../services/commercialGovernanceApi';
import FileDropField from '../../../components/FileDropField';
import PrivateMediaImage from '../../../components/PrivateMediaImage';

const blank = () => ({ firstName: '', lastName: '', employeeNumber: '', category: '',
  hireDate: '', isActive: true, stationIds: [], terminalIds: [],
  supervisorProfileId: '', avatarMediaUrl: null });

function accountStatusLabel(profile) {
  if (!profile.hasAccount) return 'Sin cuenta vinculada; Superadministración puede crearla';
  if (profile.accountStatus === 'Active') return 'Cuenta IAM activa; acceso móvil según permisos';
  if (['Disabled', 'Blocked'].includes(profile.accountStatus)) return 'Cuenta IAM deshabilitada';
  if (['PendingActivation', 'InvitationSent'].includes(profile.accountStatus))
    return 'Cuenta pendiente de activación';
  return 'Cuenta vinculada; estado no disponible';
}

export default function RampProfilesPanel() {
  const [catalog, setCatalog] = useState(null);
  const [accessRequests, setAccessRequests] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestVersion = useRef(0);
  const pendingIntents = useRef(new Map());
  const refresh = useCallback(async () => {
    const request = ++requestVersion.current;
    try {
      const [nextCatalog, nextRequests] = await Promise.all([
        getRampProfiles(), listRampMobileAccessRequests(),
      ]);
      if (request !== requestVersion.current) return;
      setCatalog(nextCatalog);
      setAccessRequests(nextRequests);
      for (const profileId of pendingIntents.current.keys())
        if (nextRequests.some(item => item.rampProfileId === profileId &&
          item.id === pendingIntents.current.get(profileId))) pendingIntents.current.delete(profileId);
      setError('');
    } catch {
      if (request !== requestVersion.current) return;
      setCatalog(null);
      setAccessRequests(null);
      setError('No fue posible actualizar los perfiles. Comprueba la conexión y vuelve a intentarlo.');
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => ['ramp_profiles', 'ramp_mobile_access_requests'].includes(resource))) void refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const poll = window.setInterval(() => void refresh(), 25_000);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      void observer.stop();
    };
  }, [refresh]);
  useEffect(() => {
    if (!editingId || catalog?.profiles.some(profile => profile.id === editingId)) return;
    setEditingId(null);
    setForm(blank());
    setAvatar(null);
  }, [catalog, editingId]);

  function edit(profile) {
    setAvatar(null);
    setEditingId(profile.id);
    setForm({ firstName: profile.firstName, lastName: profile.lastName,
      employeeNumber: profile.employeeNumber, category: profile.category,
      hireDate: profile.hireDate, isActive: profile.isActive,
      stationIds: profile.stations.map(station => station.id),
      terminalIds: profile.terminals?.map(terminal => terminal.id) ?? [],
      supervisorProfileId: profile.supervisorProfileId ?? '',
      avatarMediaUrl: profile.avatarMediaUrl ?? null });
    setNotice('');
  }
  async function save(event) {
    event.preventDefault();
    setError(''); setNotice('');
    if (!form.stationIds.length) { setError('Seleccione al menos una estación.'); return; }
    if (form.isActive && catalog?.availableTerminals && !form.terminalIds.length) {
      setError('Seleccione al menos una terminal de las estaciones autorizadas.'); return;
    }
    setBusy(true);
    try {
      const values = { ...form, supervisor: { id: form.supervisorProfileId || null } };
      delete values.supervisorProfileId;
      if (!catalog?.availableTerminals) delete values.terminalIds;
      if (avatar) values.avatarMediaUrl = (await uploadCommercialMedia('avatar', avatar)).url;
      await saveRampProfile(editingId, values);
      setNotice('Perfil operativo guardado. El acceso móvil requiere aprobación de Superadministración.');
      setEditingId(null); setForm(blank()); setAvatar(null);
      await refresh();
    } catch { setError('No fue posible guardar el perfil. Comprueba la conexión y vuelve a intentarlo.'); }
    finally { setBusy(false); }
  }
  async function requestAccess(profile) {
    setError(''); setNotice(''); setBusy(true);
    const requestId = pendingIntents.current.get(profile.id) ?? globalThis.crypto.randomUUID();
    pendingIntents.current.set(profile.id, requestId);
    try {
      await requestRampMobileAccess(profile.id, requestId);
      setNotice(`Solicitud de acceso móvil enviada para ${profile.firstName} ${profile.lastName}. Superadministración decidirá y entregará las credenciales manualmente.`);
      await refresh();
    } catch {
      await refresh();
      setError('No fue posible enviar la solicitud. Vuelva a intentarlo; se conservará la misma intención.');
    } finally { setBusy(false); }
  }
  function latestRequest(profileId) {
    return accessRequests?.find(item => item.rampProfileId === profileId);
  }
  function requestLabel(profile) {
    const status = latestRequest(profile.id)?.status;
    if (!status) return profile.hasAccount ? 'Cuenta vinculada sin solicitud registrada' : 'Sin solicitud de acceso';
    if (status === 'Pending') return 'Acceso móvil solicitado; pendiente de Superadministración';
    if (status === 'Rejected') return 'Solicitud de acceso rechazada';
    if (status === 'Fulfilled') return 'Solicitud de acceso satisfecha';
    return 'Estado de solicitud no disponible';
  }
  const persistedSupervisorId = catalog?.profiles.find(profile => profile.id === editingId)?.supervisorProfileId;
  const inactiveCurrentSupervisor = catalog?.profiles.find(profile =>
    profile.id === persistedSupervisorId && profile.id === form.supervisorProfileId && !profile.isActive);
  return <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[.18em] text-signal-500">Gestión Humana / Personal</p>
      <h1 className="mt-1 text-2xl font-bold">Perfiles de agentes de rampa</h1>
      <p className="mt-1 text-sm text-text-secondary-light">Registre el perfil, estaciones y terminales. Superadministración aprueba y vincula la cuenta móvil.</p></header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm">{error}</p>}
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
        <div className="flex items-center justify-between"><h2 className="font-bold">Personal registrado</h2><button type="button" onClick={refresh} className="text-xs font-semibold text-accent-600">Actualizar</button></div>
        {!catalog ? !error && <p className="mt-4 text-sm">Cargando perfiles…</p> : catalog.profiles.length === 0 ? <p className="mt-4 text-sm">Aún no hay perfiles.</p> :
          <ul className="mt-4 divide-y divide-black/5 dark:divide-white/5">{catalog.profiles.map(profile =>
            <li key={profile.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-accent-600/10 text-xs font-bold text-accent-600"><PrivateMediaImage url={profile.avatarMediaUrl} alt={`Foto de ${profile.firstName} ${profile.lastName}`} className="h-12 w-12 object-cover" />{!profile.avatarMediaUrl && profile.firstName.slice(0, 1)}</div><div><strong>{profile.firstName} {profile.lastName}</strong><p className="text-xs text-text-secondary-light">{profile.employeeNumber} · {profile.category} · {profile.stations.map(station => station.code).join(', ') || 'Sin estación activa'}</p><p className="text-xs">{profile.isActive ? 'Activo' : 'Inactivo'} · {accountStatusLabel(profile)}</p><p className="text-xs text-text-secondary-light">{requestLabel(profile)}</p>{latestRequest(profile.id)?.status === 'Rejected' && <p className="text-xs text-status-danger">Motivo: {latestRequest(profile.id).decisionReason}</p>}</div></div>
              <div className="flex gap-3"><button type="button" onClick={() => edit(profile)} className="text-xs font-semibold text-accent-600">Editar</button>{profile.isActive && !profile.hasAccount && profile.stations.length > 0 && latestRequest(profile.id)?.status !== 'Pending' && <button type="button" disabled={busy} onClick={() => requestAccess(profile)} aria-label={`Solicitar acceso móvil para ${profile.firstName} ${profile.lastName}`} className="text-xs font-semibold text-accent-600 disabled:opacity-50">Solicitar acceso móvil</button>}</div>
            </li>)}</ul>}
      </section>
      <form onSubmit={save} className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
        <h2 className="font-bold">{editingId ? 'Editar perfil' : 'Nuevo agente de rampa'}</h2>
        {[['firstName', 'Nombre'], ['lastName', 'Apellido'], ['employeeNumber', 'Número de empleado'], ['category', 'Categoría']].map(([key, label]) =>
          <label key={key} className="mt-4 block text-xs font-semibold">{label}<input required maxLength={key === 'employeeNumber' ? 32 : key === 'category' ? 64 : 100} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>)}
        <label className="mt-4 block text-xs font-semibold">Fecha de ingreso<input required type="date" max={new Date().toISOString().slice(0, 10)} value={form.hireDate} onChange={event => setForm(current => ({ ...current, hireDate: event.target.value }))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
        {form.avatarMediaUrl && !avatar && <PrivateMediaImage url={form.avatarMediaUrl} alt="Foto actual del perfil" className="mt-4 h-20 w-20 rounded-full object-cover" />}
        <FileDropField label="Foto del agente" accept="image/png,image/jpeg,image/webp" file={avatar} onFile={setAvatar} hint="PNG, JPG o WebP. Máximo 8 MB." />
        <fieldset className="mt-4"><legend className="text-xs font-semibold">Estaciones autorizadas</legend><div className="mt-2 space-y-2">{catalog?.availableStations.map(station =>
          <label key={station.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.stationIds.includes(station.id)} onChange={event => setForm(current => {
            const stationIds = event.target.checked ? [...current.stationIds, station.id]
              : current.stationIds.filter(id => id !== station.id);
            return { ...current, stationIds,
              terminalIds: current.terminalIds.filter(id => catalog?.availableTerminals?.some(
                terminal => terminal.id === id && stationIds.includes(terminal.stationId))) };
          })} />{station.code} · {station.name}</label>)}</div></fieldset>
        {catalog?.availableTerminals && <fieldset className="mt-4"><legend className="text-xs font-semibold">Terminales autorizadas</legend>
          <div className="mt-2 space-y-2">{catalog.availableTerminals.filter(terminal =>
            form.stationIds.includes(terminal.stationId)).map(terminal =>
            <label key={terminal.id} className="flex items-center gap-2 text-sm"><input type="checkbox"
              checked={form.terminalIds.includes(terminal.id)} onChange={event => setForm(current => ({ ...current,
                terminalIds: event.target.checked ? [...current.terminalIds, terminal.id]
                  : current.terminalIds.filter(id => id !== terminal.id) }))} />
              {terminal.name} ({terminal.code})</label>)}</div>
          {form.stationIds.length > 0 && !catalog.availableTerminals.some(terminal =>
            form.stationIds.includes(terminal.stationId)) && <p className="mt-2 text-xs text-status-danger">No hay terminales activas para la estación elegida.</p>}
        </fieldset>}
        <label className="mt-4 block text-xs font-semibold">Supervisor
          <select value={form.supervisorProfileId} onChange={event => setForm(current => ({ ...current,
            supervisorProfileId: event.target.value }))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark">
            <option value="">Sin supervisor</option>
            {inactiveCurrentSupervisor && <option value={inactiveCurrentSupervisor.id}>
              {inactiveCurrentSupervisor.firstName} {inactiveCurrentSupervisor.lastName} · {inactiveCurrentSupervisor.employeeNumber} · Inactiva (relación existente)
            </option>}
            {catalog?.profiles.filter(profile => profile.isActive && profile.id !== editingId).map(profile =>
              <option key={profile.id} value={profile.id}>{profile.firstName} {profile.lastName} · {profile.employeeNumber}</option>)}
          </select>
        </label>
        {editingId && <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />Perfil activo</label>}
        <div className="mt-5 flex gap-2"><button disabled={busy || !catalog} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar perfil</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm(blank()); setAvatar(null); }} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>}</div>
      </form>
    </div>
  </div>;
}
