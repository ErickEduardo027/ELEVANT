import { useEffect, useRef, useState } from 'react';
import Drawer from '../../components/Drawer';
import FileDropField from '../../components/FileDropField';
import PrivateMediaImage from '../../components/PrivateMediaImage';
import { useTranslation } from '../../i18n/LanguageScope';
import { uploadCommercialMedia } from '../../services/commercialGovernanceApi';
import {
  createDepartmentAdministrator,
  requestDepartmentUserAccess,
  updateDepartmentUser,
} from '../../services/departmentGovernanceService';
import { governanceMessage, listAccessCandidates } from '../../services/humanResourcesEmployeesService';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { departmentUsersMessages } from './departmentUsersMessages';
import GeneratePasswordField from './GeneratePasswordField';
import PermissionMatrix from './PermissionMatrix';
import { newRequestId } from './useDepartmentGovernance';

const inputClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const labelClass = 'block text-xs font-semibold text-ink-900 dark:text-text-primary-dark';

function blank(user) {
  return {
    temporaryPassword: '',
    stationIds: user?.stations?.map(station => station.id) ?? [],
    grantMode: user && !user.accessProfileId ? 'custom' : 'profile',
    accessProfileId: user?.accessProfileId ?? '',
    permissionCodes: user && !user.accessProfileId ? user.permissions : [],
    terminalIds: [],
    supervisorRampAgentId: '',
    avatarMediaUrl: user?.avatarMediaUrl ?? null,
  };
}

/** Employees of the department that can receive access (registered by Human Resources, no active account). */
function EmployeePicker({ department, value, onChange, excludeRamp }) {
  const { t } = useTranslation(departmentUsersMessages);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      listAccessCandidates(department, search.trim() || undefined)
        .then(result => { if (active) { setCandidates(result); setError(''); } })
        .catch(failure => { if (active) { setCandidates([]); setError(governanceMessage(failure)); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [department, search]);
  const visible = (candidates ?? []).filter(candidate => !excludeRamp || !candidate.position.isRampPosition);
  if (value) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-accent-600/40 bg-accent-600/5 p-3">
        <div className="min-w-0 text-sm">
          <strong>{value.firstName} {value.lastName}</strong>
          <span className="block text-xs text-text-secondary-light">{value.employeeNumber} · {value.position.name}{value.position.isRampPosition ? t('account.rampSuffix') : ''}</span>
          <span className="block text-xs">{value.email ?? t('account.noCorporateEmail')}{value.accountStatus === 'Disabled' ? t('account.reusesDisabledAccount') : ''}</span>
        </div>
        <button type="button" onClick={() => onChange(null)} className="min-h-[32px] text-xs font-semibold text-accent-600">{t('account.change')}</button>
      </div>
    );
  }
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>{t('account.employee')}</legend>
      <input type="search" aria-label={t('account.searchEmployee')} placeholder={t('account.searchEmployeePlaceholder')} value={search}
        onChange={event => setSearch(event.target.value)} className={inputClass} />
      {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
      {!candidates ? <p role="status" className="text-xs">{t('account.searchingEmployees')}</p> : visible.length === 0 ? (
        <p className="text-xs text-text-secondary-light">{t('account.noCandidates')}</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {visible.map(candidate => (
            <li key={candidate.employeeId}>
              <button type="button" onClick={() => onChange(candidate)}
                className="flex min-h-[44px] w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2 text-left text-sm hover:border-accent-600 dark:border-white/10">
                <span><strong>{candidate.firstName} {candidate.lastName}</strong>
                  <span className="block text-xs text-text-secondary-light">{candidate.employeeNumber} · {candidate.position.name}</span></span>
                {!candidate.email && <span className="text-xs text-status-warning">{t('account.noEmail')}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/**
 * Access form. A department administrator requests access for an employee of its department; the super
 * administrator names administrators from employees; both edit access of existing users. Identity data
 * comes from the Human Resources record (ADR-0017).
 */
export default function AccountFormDrawer({ open, mode, department, user, profiles, options, catalog, onClose, onSaved }) {
  const { t } = useTranslation(departmentUsersMessages);
  const [form, setForm] = useState(() => blank(user));
  const [employee, setEmployee] = useState(null);
  const [avatar, setAvatar] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(newRequestId());
  const keys = useRef(createCommandKeyHolder());

  useEffect(() => {
    if (!open) return;
    setForm(blank(user));
    setEmployee(null);
    setAvatar(null);
    setError('');
    requestId.current = newRequestId();
    keys.current.reset();
  }, [open, user]);

  const isEdit = mode === 'edit';
  const isRamp = employee?.position.isRampPosition || user?.kind === 'RampAgent';
  const isAdministrator = mode === 'administrator' || user?.kind === 'Administrator';
  const editsGrants = !isAdministrator && !isRamp;
  const activeProfiles = (profiles ?? []).filter(profile => profile.isActive);
  const set = patch => setForm(current => ({ ...current, ...patch }));
  const toggle = (key, id) => set({
    [key]: form[key].includes(id) ? form[key].filter(item => item !== id) : [...form[key], id],
  });

  function choose(candidate) {
    setEmployee(candidate);
    if (!candidate) return;
    const stationIds = candidate.stations.map(station => station.id);
    set({
      stationIds, terminalIds: [],
      ...(candidate.suggestedAccessProfileId ? { grantMode: 'profile', accessProfileId: candidate.suggestedAccessProfileId } : {}),
    });
  }

  // Stations an access may use: those of the employee that the actor also holds. An account without employee
  // record (older accounts) keeps the actor's stations as the limit (2-N21).
  const employeeStations = isEdit ? user?.employeeStations : employee?.stations;
  const grantableStations = isEdit && !employeeStations
    ? options?.stations ?? []
    : (options?.stations ?? []).filter(station => employeeStations?.some(item => item.id === station.id));

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!isEdit && !employee) { setError(t('account.errors.chooseEmployee')); return; }
    if (!isEdit && !employee.email) { setError(t('account.errors.noEmail')); return; }
    if (form.stationIds.length === 0) { setError(t('account.errors.noStation')); return; }
    if (editsGrants && form.grantMode === 'profile' && !form.accessProfileId) { setError(t('account.errors.noTemplate')); return; }
    if (editsGrants && form.grantMode === 'custom' && form.permissionCodes.length === 0) { setError(t('account.errors.noPermission')); return; }
    setBusy(true);
    try {
      const avatarMediaUrl = avatar ? (await uploadCommercialMedia('avatar', avatar)).url : form.avatarMediaUrl;
      const grants = editsGrants
        ? form.grantMode === 'profile'
          ? { accessProfileId: form.accessProfileId, permissionCodes: null }
          : { accessProfileId: null, permissionCodes: form.permissionCodes }
        : { accessProfileId: null, permissionCodes: null };
      if (isEdit) {
        const body = { firstName: user.firstName, lastName: user.lastName, email: user.email,
          stationIds: form.stationIds, avatarMediaUrl, ...grants, expectedVersion: user.version };
        await keys.current.run('department-user.update', { id: user.id, ...body },
          key => updateDepartmentUser(department, user.id, body, key));
      } else if (mode === 'request') {
        await requestDepartmentUserAccess(department, {
          requestId: requestId.current, employeeId: employee.employeeId, stationIds: form.stationIds, avatarMediaUrl, ...grants,
          ...(isRamp ? { terminalIds: form.terminalIds, supervisorRampAgentId: form.supervisorRampAgentId || null } : {}),
        });
      } else {
        const body = { employeeId: employee.employeeId, stationIds: form.stationIds, temporaryPassword: form.temporaryPassword };
        await keys.current.run('department-user.administrator', body,
          key => createDepartmentAdministrator(department, body, key));
      }
      onSaved(mode);
    } catch (failure) {
      setError(governanceMessage(failure, t('account.errors.conflict')));
    } finally {
      setBusy(false);
    }
  }

  const terminals = (options?.terminals ?? []).filter(terminal => form.stationIds.includes(terminal.stationId));

  return (
    <Drawer open={open} onClose={onClose} title={mode ? t(`account.titles.${mode}`) : ''} description={mode ? t(`account.descriptions.${mode}`) : undefined} widthClassName="lg:w-[560px]"
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10">{t('common.cancel')}</button>
        <button type="submit" form="department-account-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? t('common.saving') : mode === 'request' ? t('common.sendToHumanResources') : t('common.save')}
        </button>
      </div>}>
      {open && (
        <form id="department-account-form" onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          {isEdit ? (
            <div className="rounded-xl bg-black/[.03] p-3 text-sm dark:bg-white/[.04]">
              <strong>{user.firstName} {user.lastName}</strong>
              <span className="block text-xs text-text-secondary-light">{user.email}</span>
            </div>
          ) : (
            <EmployeePicker department={department} value={employee} onChange={choose} excludeRamp={mode === 'administrator'} />
          )}
          {mode === 'administrator' && employee && (
            <GeneratePasswordField id="department-account-password" fieldClassName={labelClass} inputClassName={inputClass}
              value={form.temporaryPassword} onChange={temporaryPassword => set({ temporaryPassword })} />
          )}
          {(isEdit || employee) && (
            <fieldset>
              <legend className={labelClass}>{t('common.stations')}</legend>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {isEdit ? (employeeStations ? t('account.stationsHintEditEmployee') : t('account.stationsHintEdit'))
                  : t('account.stationsHintRequest')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {grantableStations.map(station => (
                  <label key={station.id} className={`flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-sm ${form.stationIds.includes(station.id) ? 'border-accent-600 bg-accent-600/5' : 'border-black/10 dark:border-white/10'}`}>
                    <input type="checkbox" checked={form.stationIds.includes(station.id)} onChange={() => toggle('stationIds', station.id)} />
                    {station.code}
                  </label>
                ))}
                {options && grantableStations.length === 0 && <p className="text-sm text-status-danger">{t('account.noCommonStations')}</p>}
              </div>
            </fieldset>
          )}
          {isRamp && !isEdit && employee && (
            <div className="space-y-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
              <p className="text-sm font-semibold">{t('account.mobileAccess')}</p>
              <label className={labelClass}>{t('account.supervisor')}<select value={form.supervisorRampAgentId} onChange={event => set({ supervisorRampAgentId: event.target.value })} className={inputClass}>
                <option value="">{t('account.noSupervisor')}</option>
                {(options?.supervisors ?? []).map(supervisor => <option key={supervisor.id} value={supervisor.id}>{supervisor.name} · {supervisor.employeeNumber}</option>)}
              </select></label>
              <fieldset>
                <legend className={labelClass}>{t('account.terminals')}</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {terminals.map(terminal => (
                    <label key={terminal.id} className="flex min-h-[40px] items-center gap-2 rounded-lg border border-black/10 px-3 text-sm dark:border-white/10">
                      <input type="checkbox" checked={form.terminalIds.includes(terminal.id)} onChange={() => toggle('terminalIds', terminal.id)} />
                      {t('account.terminal', { code: terminal.code })}
                    </label>
                  ))}
                  {terminals.length === 0 && <p className="text-xs text-text-secondary-light">{t('account.chooseStationForTerminals')}</p>}
                </div>
              </fieldset>
            </div>
          )}
          {editsGrants && (isEdit || employee) && (
            <fieldset className="space-y-3">
              <legend className={labelClass}>{t('account.permissions')}</legend>
              {employee?.suggestedAccessProfileId && <p className="text-xs text-text-secondary-light">{t('account.suggestedTemplateSelected')}</p>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[['profile', t('account.useTemplate')], ['custom', t('account.customPermissions')]].map(([value, label]) => (
                  <label key={value} className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm ${form.grantMode === value ? 'border-accent-600 bg-accent-600/5' : 'border-black/10 dark:border-white/10'}`}>
                    <input type="radio" name="grantMode" value={value} checked={form.grantMode === value} onChange={() => set({ grantMode: value })} />
                    {label}
                  </label>
                ))}
              </div>
              {form.grantMode === 'profile' ? (
                <label className={labelClass}>{t('common.template')}<select value={form.accessProfileId} onChange={event => set({ accessProfileId: event.target.value })} className={inputClass}>
                  <option value="">{t('account.chooseTemplate')}</option>
                  {activeProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
                {activeProfiles.length === 0 && <span className="mt-1 block font-normal text-text-secondary-light">{t('account.noTemplates')}</span>}
                </label>
              ) : (
                <PermissionMatrix catalog={catalog} value={form.permissionCodes} onChange={permissionCodes => set({ permissionCodes })} idPrefix="account" />
              )}
            </fieldset>
          )}
          {mode !== 'administrator' && (isEdit || employee) && (
            <div>
              {form.avatarMediaUrl && !avatar && <PrivateMediaImage url={form.avatarMediaUrl} alt={t('account.currentPhoto')} className="mb-2 h-16 w-16 rounded-full object-cover" />}
              <FileDropField label={t('account.photo')} accept="image/png,image/jpeg,image/webp" file={avatar} onFile={setAvatar} hint={t('account.photoHint')} />
            </div>
          )}
        </form>
      )}
    </Drawer>
  );
}
