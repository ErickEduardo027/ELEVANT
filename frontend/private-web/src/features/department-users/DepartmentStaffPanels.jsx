import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import { useTranslation } from '../../i18n/LanguageScope';
import { BriefcaseIcon } from '../shell/components/icons';
import ActivityPanel from '../employees/ActivityPanel';
import {
  governanceMessage, listDepartmentActivity, listDepartmentPositions, setSuggestedProfile,
} from '../../services/humanResourcesEmployeesService';
import { departmentUsersMessages } from './departmentUsersMessages';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

function Notice({ message }) {
  return message.text ? (
    <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>
  ) : null;
}

/** Positions come from Human Resources; the department chooses which access template each one starts with. */
export function DepartmentPositionsPanel({ department, profiles }) {
  const { t } = useTranslation(departmentUsersMessages);
  const [positions, setPositions] = useState(null);
  const [message, setMessage] = useState({ tone: '', text: '' });
  const load = useCallback(async () => {
    try { setPositions(await listDepartmentPositions(department)); }
    catch (failure) { setPositions([]); setMessage({ tone: 'error', text: governanceMessage(failure) }); }
  }, [department]);
  useEffect(() => { void load(); }, [load]);
  const active = (profiles ?? []).filter(profile => profile.isActive);

  async function change(position, accessProfileId) {
    try {
      await setSuggestedProfile(department, position.id, { accessProfileId: accessProfileId || null, expectedVersion: position.version });
      setMessage({ tone: 'success', text: t('positions.updated', { name: position.name }) });
    } catch (failure) {
      setMessage({ tone: 'error', text: governanceMessage(failure) });
    }
    await load();
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-text-secondary-light">{t('positions.intro')}</p>
      <Notice message={message} />
      {!positions ? <p role="status" className="text-sm">{t('positions.loading')}</p> : positions.length === 0 ? (
        <EmptyState icon={BriefcaseIcon} title={t('positions.emptyTitle')} description={t('positions.emptyDescription')} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {positions.map(position => (
            <li key={position.id} className="space-y-2 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
              <div><strong>{position.name}</strong>{!position.isActive && <span className="ml-2 text-xs text-text-secondary-light">{t('positions.inactive')}</span>}
                <span className="block text-xs text-text-secondary-light">{t('positions.employees', { n: position.employees })}{position.description ? ` · ${position.description}` : ''}</span></div>
              {position.isRampPosition ? (
                <p className="text-xs text-text-secondary-light">{t('positions.rampPosition')}</p>
              ) : (
                <label className="block text-xs font-semibold">{t('positions.suggestedTemplate')}
                  <select aria-label={t('positions.suggestedTemplateOf', { name: position.name })} value={position.suggestedAccessProfileId ?? ''} onChange={event => void change(position, event.target.value)} className={fieldClass}>
                    <option value="">{t('positions.noSuggestion')}</option>
                    {active.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select></label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Activity of the department's people: sign-ins, access changes and operational actions. */
export function DepartmentActivityPanel({ department }) {
  const load = useCallback(filters => listDepartmentActivity(department, filters), [department]);
  return <ActivityPanel load={load} />;
}
