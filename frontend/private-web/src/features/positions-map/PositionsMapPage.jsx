import { useState } from 'react';
import TerminalSelector from './components/TerminalSelector';
import PositionSearchBar from './components/PositionSearchBar';
import PositionListItem from './components/PositionListItem';
import PositionDetailDrawer from './components/PositionDetailDrawer';
import PositionSummary from './components/PositionSummary';
import PositionToastStack from './components/PositionToast';
import EmptyPositionsState from './components/EmptyPositionsState';
import { usePositionsMapFilters } from './usePositionsMapFilters';
import { usePositionAlerts } from './usePositionAlerts';
import { findPositionByQuery } from './positionsMapMappers';
import { ADMIN_OCC_MODULE_IDS } from '../admin-occ/navigation';
import { useTranslation } from '../../i18n/LanguageScope';
import { positionsMapMessages } from './positionsMapMessages';
import { occUiMessages } from '../admin-occ/ui/occUiMessages';
import styles from '../admin-occ/ui/OccWorkspace.module.css';

export function assignCandidates(data) {
  const elsewhere = (data?.stands ?? []).flatMap(stand =>
    (stand.turnarounds ?? []).map(item => ({ ...item, standCode: stand.code })));
  return [...(data?.unassigned ?? []), ...elsewhere];
}

export default function PositionsMapPage({ status, data, error, connection, lastUpdatedAt,
  onRetry, forceState = 'default', onNavigateToResource = () => {} }) {
  const { t, locale } = useTranslation(positionsMapMessages);
  const { t: ui } = useTranslation(occUiMessages);
  const [selectedPositionId, setSelectedPositionId] = useState(null);
  const [searchNotFound, setSearchNotFound] = useState(false);
  const denied = status === 'forbidden' || error?.status === 403;
  const expired = status === 'unauthorized' || error?.status === 401;
  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = denied || expired || (status === 'error' && forceState === 'default') || forceState === 'positionsMapError';
  const positions = forceState === 'positionsMapEmpty' ? [] : data?.positions ?? [];
  const displayConnection = forceState === 'positionsMapDisconnected' ? 'disconnected' : connection;
  const { search, setSearch, terminalFilter, setTerminalFilter, filteredPositions } = usePositionsMapFilters(positions);
  const { toasts, dismissToast } = usePositionAlerts(positions, displayConnection);
  const selectedPosition = !isLoading && !isError ? positions.find(position => position.id === selectedPositionId) ?? null : null;
  const emptyReason = positions.length === 0 ? 'no-positions' : filteredPositions.length === 0 ? 'no-results' : null;
  return <section className="space-y-5">
    <header data-occ-header><div><h1>{ui('positions')}</h1><p className="mt-2 text-sm text-occ-muted">{data?.station?.code && <span className="mr-2 font-mono font-semibold">{data.station.code}</span>}{ui('positionsHint')}</p></div>
      <button type="button" disabled={denied || expired} onClick={onRetry} className="rounded-md border border-occ-line bg-occ-panel px-4 text-sm font-semibold text-occ-accent">{ui('refresh')}</button></header>
    <div data-occ-toolbar className="flex flex-wrap items-end gap-4">
      <TerminalSelector active={terminalFilter} onChange={setTerminalFilter} />
      <PositionSearchBar value={search} onChange={value => { setSearch(value); setSearchNotFound(false); }}
        onSubmit={query => { const found = findPositionByQuery(positions, query); setSearchNotFound(!found); if (found) setSelectedPositionId(found.id); }} notFound={searchNotFound} />
      <p className="text-xs text-occ-muted sm:ml-auto">{ui('mapsInPanorama')}</p>
    </div>
    {data?.source === 'planning' && <p role="status" className="rounded-lg border border-accent-600/25 bg-accent-600/5 p-3 text-sm">{t('page.planningNote')}</p>}
    {displayConnection === 'disconnected' && <p role="status" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm">
      {t('page.disconnected')}{lastUpdatedAt && <span className="ml-2 font-mono text-xs">{new Date(lastUpdatedAt).toLocaleTimeString(locale)}</span>}</p>}
    {isLoading ? <p role="status" data-occ-surface>{ui('loading')}</p> : isError ?
      <div role="alert" data-occ-surface><h2 className="font-semibold text-status-danger">{denied ? ui('forbidden') : expired ? ui('sessionExpired') : t('page.errorTitle')}</h2>
        {!denied && !expired && <><p className="mt-2 text-sm">{t('page.errorFallback')}</p><button type="button" onClick={onRetry} className="mt-4 rounded-md bg-accent-600 px-4 font-semibold text-white">{t('page.retry')}</button></>}</div> : <>
      <div data-occ-surface><PositionSummary positions={positions} source={data?.source} inline /></div>
      <div data-occ-surface><p className="mb-4 text-xs font-semibold text-occ-muted">{ui('positionsCount', { count: filteredPositions.length })}</p>
        {emptyReason ? <EmptyPositionsState reason={emptyReason} /> : <div className={styles.listGrid}>
          {filteredPositions.map(position => <div key={position.id}><PositionListItem position={position} selected={position.id === selectedPositionId} onSelect={setSelectedPositionId} />{data?.source === 'planning-no-map' && <p className="mt-2 text-xs text-occ-muted">{t('page.plannedFlights', { flights: position.plannedFlights?.join(', ') || t('page.noFlightNumber') })}</p>}</div>)}
        </div>}</div>
    </>}
    <PositionDetailDrawer position={selectedPosition} onClose={() => setSelectedPositionId(null)}
      onViewFlightInMonitoring={flightId => onNavigateToResource(ADMIN_OCC_MODULE_IDS.FLIGHT_MONITORING, flightId)}
      canAssign={Boolean(data?.canAssign)} candidates={assignCandidates(data)} onChanged={onRetry} />
    {!isLoading && !isError && <PositionToastStack toasts={toasts} onDismiss={dismissToast} />}
  </section>;
}
