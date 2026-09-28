import { useCallback, useEffect, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getRampProfiles, saveRampProfile, uploadCommercialMedia } from '../../../services/commercialGovernanceApi';
import FileDropField from '../../../components/FileDropField';
import PrivateMediaImage from '../../../components/PrivateMediaImage';

const blank = () => ({ firstName: '', lastName: '', employeeNumber: '', category: '',
  hireDate: '', isActive: true, stationIds: [], avatarMediaUrl: null });

export default function RampProfilesPanel() {
  const [catalog, setCatalog] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    try { setCatalog(await getRampProfiles()); setError(''); }
    catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('ramp_profiles')) void refresh();
    });
    void observer.start();
    return () => observer.stop();
  }, [refresh]);

  function edit(profile) {
    setAvatar(null);
    setEditingId(profile.id);
    setForm({ firstName: profile.firstName, lastName: profile.lastName,
      employeeNumber: profile.employeeNumber, category: profile.category,
      hireDate: profile.hireDate, isActive: profile.isActive,
      stationIds: profile.stations.map(station => station.id), avatarMediaUrl: profile.avatarMediaUrl ?? null });
    setNotice('');
  }
  async function save(event) {
    event.preventDefault();
    setError(''); setNotice('');
    if (!form.stationIds.length) { setError('Seleccione al menos una estación.'); return; }
    setBusy(true);
    try {
      const values = { ...form };
      if (avatar) values.avatarMediaUrl = (await uploadCommercialMedia('avatar', avatar)).url;
      await saveRampProfile(editingId, values);
      setNotice('Perfil operativo guardado. Superadministración ya puede vincular su cuenta de acceso.');
      setEditingId(null); setForm(blank()); setAvatar(null);
      await refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-[1440px] space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[.18em] text-signal-500">Gestión Humana / Personal</p>
      <h1 className="mt-1 text-2xl font-bold">Perfiles de agentes de rampa</h1>
      <p className="mt-1 text-sm text-text-secondary-light">Registre el perfil y sus estaciones. Superadministración crea y vincula la cuenta móvil.</p></header>
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm">{error}</p>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
        <div className="flex items-center justify-between"><h2 className="font-bold">Personal registrado</h2><button type="button" onClick={refresh} className="text-xs font-semibold text-accent-600">Actualizar</button></div>
        {!catalog ? <p className="mt-4 text-sm">Cargando perfiles…</p> : catalog.profiles.length === 0 ? <p className="mt-4 text-sm">Aún no hay perfiles.</p> :
          <ul className="mt-4 divide-y divide-black/5 dark:divide-white/5">{catalog.profiles.map(profile =>
            <li key={profile.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-accent-600/10 text-xs font-bold text-accent-600"><PrivateMediaImage url={profile.avatarMediaUrl} alt={`Foto de ${profile.firstName} ${profile.lastName}`} className="h-12 w-12 object-cover" />{!profile.avatarMediaUrl && profile.firstName.slice(0, 1)}</div><div><strong>{profile.firstName} {profile.lastName}</strong><p className="text-xs text-text-secondary-light">{profile.employeeNumber} · {profile.category} · {profile.stations.map(station => station.code).join(', ') || 'Sin estación activa'}</p><p className="text-xs">{profile.isActive ? 'Activo' : 'Inactivo'} · {profile.hasAccount ? 'Cuenta vinculada' : 'Cuenta pendiente de Superadministración'}</p></div></div>
              <button type="button" onClick={() => edit(profile)} className="text-xs font-semibold text-accent-600">Editar</button>
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
          <label key={station.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.stationIds.includes(station.id)} onChange={event => setForm(current => ({ ...current,
            stationIds: event.target.checked ? [...current.stationIds, station.id] : current.stationIds.filter(id => id !== station.id) }))} />{station.code} · {station.name}</label>)}</div></fieldset>
        {editingId && <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />Perfil activo</label>}
        <div className="mt-5 flex gap-2"><button disabled={busy || !catalog} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar perfil</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm(blank()); setAvatar(null); }} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>}</div>
      </form>
    </div>
  </div>;
}
