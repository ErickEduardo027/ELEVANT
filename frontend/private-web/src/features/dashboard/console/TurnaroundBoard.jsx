import { useState } from 'react';
import Link from 'next/link';
import Badge from '../../../components/Badge';
import { getPlanningStatusMeta } from '../../planning/planningStatus';
import { TURNAROUND_FILTERS, legTime, missingResources } from '../dashboardModel';
import ConsolePanel, { PanelLink } from './ConsolePanel';
import { formatTime } from './format';

const MAX_ROWS = 40;

const STATUS_TONE = {
  info: 'bg-occ-accent',
  active: 'bg-signal-500',
  success: 'bg-occ-ok',
  warning: 'bg-occ-warn',
  danger: 'bg-occ-danger',
};

function StatusCell({ status, language }) {
  const meta = getPlanningStatusMeta(status, language);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-occ-text">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${STATUS_TONE[meta.color] ?? STATUS_TONE.info}`} />
      {meta.label}
    </span>
  );
}

function TimeCell({ t, turnaround, locale, timeZone }) {
  const time = legTime(turnaround.arrival) ?? legTime(turnaround.departure);
  if (!time) return <span className="text-occ-muted">—</span>;
  return (
    <span className="whitespace-nowrap">
      <time dateTime={time.at} className="font-mono text-sm font-medium text-occ-text">{formatTime(time.at, locale, timeZone)}</time>
      <span className="ml-1.5 text-[10.5px] text-occ-muted">{t(`board.timeKind.${time.kind}`)}</span>
    </span>
  );
}

export default function TurnaroundBoard({ t, language, locale, timeZone, groups, className = '' }) {
  const [filter, setFilter] = useState('all');
  const rows = groups[filter] ?? [];
  const visible = rows.slice(0, MAX_ROWS);
  const columns = t('board.columns');

  return (
    <ConsolePanel className={className} title={t('board.title')}
      actions={<PanelLink href="/admin-occ/planning">{t('board.open')}</PanelLink>}
      bodyClassName="flex flex-col">
      <div role="group" aria-label={t('board.filterLabel')}
        className="flex gap-1 overflow-x-auto border-b border-occ-line px-3 py-2">
        {TURNAROUND_FILTERS.map(id => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
            className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors ${
              filter === id ? 'bg-occ-accent-soft text-occ-accent' : 'text-occ-muted hover:bg-occ-panel-muted hover:text-occ-text'}`}>
            {t(`board.filters.${id}`)}
            <span className="font-mono text-[11px]">{groups[id]?.length ?? 0}</span>
          </button>
        ))}
      </div>

      {groups.all.length === 0
        ? <p className="px-4 py-8 text-center text-sm text-occ-muted">{t('board.empty')}</p>
        : rows.length === 0
          ? <p className="px-4 py-8 text-center text-sm text-occ-muted">{t('board.emptyFilter')}</p>
          : <div className="min-h-0 flex-1 overflow-auto">
            <table className="table-stack w-full min-w-[46rem] border-collapse text-left text-sm">
              <thead className="sticky top-0 z-[1] bg-occ-panel-muted text-[10.5px] font-semibold uppercase tracking-[0.12em] text-occ-muted">
                <tr>
                  {['time', 'operation', 'flights', 'airline', 'stand', 'agents', 'status'].map(key => (
                    <th key={key} scope="col" className="border-b border-occ-line px-3 py-2 first:pl-4">{columns[key]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-occ-line">
                {visible.map(item => {
                  const missing = missingResources(item);
                  return (
                    <tr key={item.id} className="hover:bg-occ-panel-muted">
                      <td className="px-3 py-2 pl-4"><TimeCell t={t} turnaround={item} locale={locale} timeZone={timeZone} /></td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <Link href="/admin-occ/planning" className="font-mono text-[13px] font-semibold text-occ-text hover:text-occ-accent hover:underline">
                            {item.operationCode}
                          </Link>
                          {/* ADR-0041: a demo flight the superadministrator triggered is always labelled as such. */}
                          {item.isDemo === true && <Badge label="Demo" />}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-occ-text">
                        {item.arrival?.flightNumber ?? <span className="font-sans text-occ-muted">{t('board.noArrival')}</span>}
                        <span aria-hidden="true" className="mx-1 text-occ-muted">→</span>
                        {item.departure?.flightNumber ?? <span className="font-sans text-occ-muted">{t('board.noDeparture')}</span>}
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-occ-text" title={item.airline?.name}>{item.airline?.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {item.stand?.code
                          ? <span className="text-occ-text">{item.stand.code}</span>
                          : <span className={`font-sans ${missing.includes('stand') ? 'text-occ-warn' : 'text-occ-muted'}`}>{t('board.noStand')}</span>}
                      </td>
                      <td className={`px-3 py-2 font-mono text-xs ${missing.includes('agents') ? 'text-occ-warn' : 'text-occ-text'}`}>
                        {item.agents?.length ?? 0}
                      </td>
                      <td className="px-3 py-2"><StatusCell status={item.status} language={language} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>}
      {rows.length > MAX_ROWS && (
        <p className="border-t border-occ-line px-4 py-2 text-xs text-occ-muted">
          {t('board.showing', { shown: MAX_ROWS, total: rows.length })}
        </p>
      )}
    </ConsolePanel>
  );
}
