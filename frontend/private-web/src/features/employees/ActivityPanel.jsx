import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import { useTranslation } from '../../i18n/LanguageScope';
import { ChecklistIcon } from '../shell/components/icons';
import { DEPARTMENTS, DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import { governanceMessage } from '../../services/humanResourcesEmployeesService';
import { activityActionLabels, activityPanelMessages } from './activityPanelMessages';
import { fieldClass } from './EmployeeForms';

const CATEGORIES = ['', 'login', 'governance', 'operation'];
// A 403 is translated at render time so the effect that loads the trail does not depend on the language.
const RANGE_ERROR = Symbol('range-error');
const isoDate = date => date.toISOString().slice(0, 10);

export const actionLabel = (action, language = 'es') => activityActionLabels[language]?.[action] ?? action;

/**
 * Audit trail reader shared by Human Resources, department administrators and the super administrator.
 * <paramref name="load"/> receives the filters plus the paging cursor and returns an ActivityPage.
 */
export default function ActivityPanel({ load, departmentFilter = false }) {
  const { t, language, locale } = useTranslation(activityPanelMessages);
  const now = new Date();
  const [filters, setFilters] = useState({ from: isoDate(new Date(now.getTime() - 7 * 86400000)), to: isoDate(now), category: '', department: '' });
  const [entries, setEntries] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const range = useCallback(() => ({
    from: new Date(`${filters.from}T00:00:00`).toISOString(),
    to: new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400000).toISOString(),
    category: filters.category || undefined, department: filters.department || undefined,
  }), [filters]);

  const read = useCallback(async () => {
    setBusy(true);
    try {
      const page = await load(range());
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setError('');
    } catch (failure) {
      setEntries([]);
      setError(failure?.status === 403 ? RANGE_ERROR : governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }, [load, range]);
  useEffect(() => { void read(); }, [read]);

  async function more() {
    setBusy(true);
    try {
      const page = await load({ ...range(), cursor });
      setEntries(current => [...current, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" aria-label={t('label')}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold">{t('from')}<input type="date" value={filters.from} max={filters.to} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} className={fieldClass} /></label>
        <label className="text-xs font-semibold">{t('to')}<input type="date" value={filters.to} min={filters.from} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} className={fieldClass} /></label>
        <label className="text-xs font-semibold">{t('type')}<select value={filters.category} onChange={event => setFilters(current => ({ ...current, category: event.target.value }))} className={fieldClass}>
          {CATEGORIES.map(value => <option key={value} value={value}>{t(`categories.${value || 'all'}`)}</option>)}</select></label>
        {departmentFilter && <label className="text-xs font-semibold">{t('department')}<select value={filters.department} onChange={event => setFilters(current => ({ ...current, department: event.target.value }))} className={fieldClass}>
          <option value="">{t('allDepartments')}</option>{Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error === RANGE_ERROR ? t('rangeError') : error}</p>}
      {!entries ? <p role="status" className="text-sm">{t('loading')}</p> : entries.length === 0 ? (
        <EmptyState icon={ChecklistIcon} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ol className="divide-y divide-black/5 rounded-xl border border-black/5 bg-white dark:divide-white/5 dark:border-white/5 dark:bg-surface-dark-card">
          {entries.map(entry => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <strong>{entry.actorName ?? t('system')}</strong> · {actionLabel(entry.action, language)}
                <span className="block text-xs text-text-secondary-light">
                  {entry.department ? DEPARTMENT_LABELS[entry.department] : ''}{entry.stationCode ? ` · ${entry.stationCode}` : ''}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </span>
              </div>
              <time className="text-xs tabular-nums text-text-secondary-light" dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString(locale)}</time>
            </li>
          ))}
        </ol>
      )}
      {cursor && <button type="button" disabled={busy} onClick={() => void more()} className="min-h-[40px] rounded-lg border px-4 text-sm font-semibold disabled:opacity-60">{t('loadMore')}</button>}
    </section>
  );
}
