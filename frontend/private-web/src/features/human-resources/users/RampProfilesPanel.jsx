import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getRampProfiles, saveRampProfile, uploadCommercialMedia } from '../../../services/commercialGovernanceApi';
import FileDropField from '../../../components/FileDropField';
import PrivateMediaImage from '../../../components/PrivateMediaImage';
import { useTranslation } from '../../../i18n/LanguageScope';
import { rampProfilesPanelMessages } from './rampProfilesPanelMessages';

const blank = () => ({ firstName: '', lastName: '', employeeNumber: '', category: '',
  hireDate: '', isActive: true, stationIds: [], terminalIds: [],
  supervisorProfileId: '', avatarMediaUrl: null });

function accountStatusKey(profile) {
  if (!profile.hasAccount) return 'account.none';
  if (profile.accountStatus === 'Active') return 'account.active';
  if (['Disabled', 'Blocked'].includes(profile.accountStatus)) return 'account.disabled';
  if (['PendingActivation', 'InvitationSent'].includes(profile.accountStatus))
    return 'account.pending';
  return 'account.unknown';
}

/**
 * Operational profiles of ramp agents. Human Resources consults them; the
 * Operations administrator maintains them (`canEdit`). New agents are requested
 * by Operations and created when Human Resources validates the request.
 */
export default function RampProfilesPanel({ canEdit = false, embedded = false, stationFilter = null }) {
  const { t } = useTranslation(rampProfilesPanelMessages);
  const [catalog, setCatalog] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(null);
  // Message keys, translated at render time so a language change also applies to them.
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestVersion.current;
    try {
      const nextCatalog = await getRampProfiles();
      if (request !== requestVersion.current) return;
      setCatalog(nextCatalog);
      setError('');
    } catch {
      if (request !== requestVersion.current) return;
      setCatalog(null);
      setError('errors.refresh');
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { requestVersion.current += 1; };
  }, [refresh]);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => ['ramp_profiles', 'department_users'].includes(resource))) void refresh();
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
    if (!form.stationIds.length) { setError('errors.noStation'); return; }
    if (form.isActive && catalog?.availableTerminals && !form.terminalIds.length) {
      setError('errors.noTerminal'); return;
    }
    setBusy(true);
    try {
      const values = { ...form, supervisor: { id: form.supervisorProfileId || null } };
      delete values.supervisorProfileId;
      if (!catalog?.availableTerminals) delete values.terminalIds;
      if (avatar) values.avatarMediaUrl = (await uploadCommercialMedia('avatar', avatar)).url;
      await saveRampProfile(editingId, values);
      setNotice('saved');
      setEditingId(null); setForm(blank()); setAvatar(null);
      await refresh();
    } catch { setError('errors.save'); }
    finally { setBusy(false); }
  }
  const persistedSupervisorId = catalog?.profiles.find(profile => profile.id === editingId)?.supervisorProfileId;
  const inactiveCurrentSupervisor = catalog?.profiles.find(profile =>
    profile.id === persistedSupervisorId && profile.id === form.supervisorProfileId && !profile.isActive);
  const showForm = canEdit && editingId;
  return <div className={embedded ? 'space-y-5' : 'mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-5'}>
    {!embedded && <header><p className="text-xs font-bold uppercase tracking-[.18em] text-signal-500">{t('eyebrow')}</p>
      <h1 className="mt-1 text-2xl font-bold">{t('title')}</h1>
      <p className="mt-1 text-sm text-text-secondary-light">{t('description')}</p></header>}
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{t(notice)}</p>}
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm">{t(error)}</p>}
    <div className={showForm ? 'grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_390px]' : 'grid grid-cols-1 gap-5'}>
      <section className="rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
        <div className="flex items-center justify-between"><h2 className="font-bold">{t('registered')}</h2><button type="button" onClick={refresh} className="text-xs font-semibold text-accent-600">{t('refresh')}</button></div>
        {!catalog ? !error && <p className="mt-4 text-sm">{t('loading')}</p> : catalog.profiles.length === 0 ? <p className="mt-4 text-sm">{t('empty')}</p> :
          <ul className="mt-4 divide-y divide-black/5 dark:divide-white/5">{catalog.profiles.map(profile =>
            <li key={profile.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-accent-600/10 text-xs font-bold text-accent-600"><PrivateMediaImage url={profile.avatarMediaUrl} alt={t('photoOf', { name: `${profile.firstName} ${profile.lastName}` })} className="h-12 w-12 object-cover" />{!profile.avatarMediaUrl && profile.firstName.slice(0, 1)}</div><div><strong>{profile.firstName} {profile.lastName}</strong><p className="text-xs text-text-secondary-light">{profile.employeeNumber} · {profile.category} · {profile.stations.map(station => station.code).join(', ') || t('noActiveStation')}</p><p className="text-xs">{profile.isActive ? t('active') : t('inactive')} · {t(accountStatusKey(profile))}</p></div></div>
              {canEdit && <div className="flex gap-3"><button type="button" onClick={() => edit(profile)} className="min-h-[32px] text-xs font-semibold text-accent-600">{t('edit')}</button></div>}
            </li>)}</ul>}
      </section>
      {showForm && <form onSubmit={save} className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
        <h2 className="font-bold">{t('edit')}</h2>
        {['firstName', 'lastName', 'employeeNumber', 'category'].map(key =>
          <label key={key} className="mt-4 block text-xs font-semibold">{t(`fields.${key}`)}<input required readOnly title={t('editedInRecord')} maxLength={key === 'employeeNumber' ? 32 : key === 'category' ? 120 : 100} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>)}
        <p className="mt-4 rounded-lg bg-black/[.03] p-3 text-xs dark:bg-white/[.04]">{t('recordNotice')}</p>
        <label className="mt-4 block text-xs font-semibold">{t('hireDate')}<input required readOnly type="date" max={new Date().toISOString().slice(0, 10)} value={form.hireDate} onChange={event => setForm(current => ({ ...current, hireDate: event.target.value }))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
        {form.avatarMediaUrl && !avatar && <PrivateMediaImage url={form.avatarMediaUrl} alt={t('currentPhoto')} className="mt-4 h-20 w-20 rounded-full object-cover" />}
        <FileDropField label={t('photo')} accept="image/png,image/jpeg,image/webp" file={avatar} onFile={setAvatar} hint={t('photoHint')} />
        <fieldset className="mt-4"><legend className="text-xs font-semibold">{t('stations')}</legend><div className="mt-2 space-y-2">{catalog?.availableStations.filter(station => !stationFilter || stationFilter.includes(station.id) ||
          form.stationIds.includes(station.id)).map(station =>
          <label key={station.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.stationIds.includes(station.id)} onChange={event => setForm(current => {
            const stationIds = event.target.checked ? [...current.stationIds, station.id]
              : current.stationIds.filter(id => id !== station.id);
            return { ...current, stationIds,
              terminalIds: current.terminalIds.filter(id => catalog?.availableTerminals?.some(
                terminal => terminal.id === id && stationIds.includes(terminal.stationId))) };
          })} />{station.code} · {station.name}</label>)}</div></fieldset>
        {catalog?.availableTerminals && <fieldset className="mt-4"><legend className="text-xs font-semibold">{t('terminals')}</legend>
          <div className="mt-2 space-y-2">{catalog.availableTerminals.filter(terminal =>
            form.stationIds.includes(terminal.stationId)).map(terminal =>
            <label key={terminal.id} className="flex items-center gap-2 text-sm"><input type="checkbox"
              checked={form.terminalIds.includes(terminal.id)} onChange={event => setForm(current => ({ ...current,
                terminalIds: event.target.checked ? [...current.terminalIds, terminal.id]
                  : current.terminalIds.filter(id => id !== terminal.id) }))} />
              {terminal.name} ({terminal.code})</label>)}</div>
          {form.stationIds.length > 0 && !catalog.availableTerminals.some(terminal =>
            form.stationIds.includes(terminal.stationId)) && <p className="mt-2 text-xs text-status-danger">{t('noTerminals')}</p>}
        </fieldset>}
        <label className="mt-4 block text-xs font-semibold">{t('supervisor')}
          <select value={form.supervisorProfileId} onChange={event => setForm(current => ({ ...current,
            supervisorProfileId: event.target.value }))} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark">
            <option value="">{t('noSupervisor')}</option>
            {inactiveCurrentSupervisor && <option value={inactiveCurrentSupervisor.id}>
              {inactiveCurrentSupervisor.firstName} {inactiveCurrentSupervisor.lastName} · {inactiveCurrentSupervisor.employeeNumber} · {t('inactiveSupervisor')}
            </option>}
            {catalog?.profiles.filter(profile => profile.isActive && profile.id !== editingId).map(profile =>
              <option key={profile.id} value={profile.id}>{profile.firstName} {profile.lastName} · {profile.employeeNumber}</option>)}
          </select>
        </label>
        {editingId && <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />{t('profileActive')}</label>}
        <div className="mt-5 flex gap-2"><button disabled={busy || !catalog} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('save')}</button><button type="button" onClick={() => { setEditingId(null); setForm(blank()); setAvatar(null); }} className="rounded-lg border px-4 py-2 text-sm">{t('cancel')}</button></div>
      </form>}
    </div>
  </div>;
}
