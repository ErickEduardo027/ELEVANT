import { useEffect, useMemo, useState } from 'react';
import PlanningHeader from './components/PlanningHeader';
import PlanningFilters from './components/PlanningFilters';
import PlanningKPIs from './components/PlanningKPIs';
import ViewSwitcher from './components/ViewSwitcher';
import FlightTimeline from './components/FlightTimeline';
import PlanningDrawer from './components/PlanningDrawer';
import PlanningSkeleton from './components/PlanningSkeleton';
import ManualTurnaroundDialog from './components/ManualTurnaroundDialog';
import PlanningMap from './components/PlanningMap';
import ProviderFlightsDialog from './components/ProviderFlightsDialog';
import TurnaroundChangeDialog from './components/TurnaroundChangeDialog';
import EmptyPlanningState from './components/EmptyPlanningState';
import ModulePlaceholder from '../shell/components/ModulePlaceholder';
import { CalendarIcon } from '../shell/components/icons';
import { usePlanningFilters } from './usePlanningFilters';
import { usePlanningOptions } from './usePlanningOptions';
import { usePlanningAssignment } from './usePlanningAssignment';
import {
  computeKpis,
  getFilterOptions,
  isInitialAssignmentCandidate,
  withAssignmentReadiness,
} from './planningMappers';
import { useAssignmentReadiness } from './useAssignmentReadiness';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/Toast';
import { useTranslation } from '../../i18n/LanguageScope';
import { planningMessages } from './planningMessages';

const EMPTY_OPTIONS_STATE = {
  status: 'idle',
  data: null,
  etag: null,
  error: null,
  reason: null,
  recoverable: false,
};

function StatePanel({ kind, onRetry }) {
  const { t } = useTranslation(planningMessages);
  const unauthorized = kind === 'unauthorized';
  const forbidden = kind === 'forbidden';
  return (
    <div role={unauthorized ? 'status' : 'alert'} className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card">
      <p className="text-sm font-semibold text-status-danger">
        {unauthorized
          ? t('states.unauthorizedTitle')
          : forbidden
            ? t('states.forbiddenTitle')
            : t('states.errorTitle')}
      </p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {unauthorized
          ? t('states.unauthorizedHint')
          : forbidden
            ? t('states.forbiddenHint')
            : t('states.errorHint')}
      </p>
      {!unauthorized && !forbidden && (
        <button type="button" onClick={onRetry} className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90">{t('states.retry')}</button>
      )}
    </div>
  );
}

function NoStationScope() {
  const { t } = useTranslation(planningMessages);
  return (
    <div role="status" className="rounded-2xl border border-status-warning/30 bg-status-warning/10 p-6">
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{t('states.noScopeTitle')}</p>
      <p className="mt-2 max-w-2xl text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {t('states.noScopeHint')}
      </p>
    </div>
  );
}

const NO_FLIGHTS = [];
const CHANGE_TOASTS = { reschedule: 'change.rescheduled', cancel: 'change.cancelled', divert: 'change.diverted' };

export default function PlanningPage({
  status,
  data,
  error: _error,
  onRetry,
  stationScopes = [],
  selectedStationId = '',
  onStationChange,
  selectedDate = '',
  onDateChange,
  filterScopeKey,
  hasStationScope = true,
  forceState = 'default',
  dataRevision = 0,
}) {
  const [activeView, setActiveView] = useState('timeline');
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [optionsRetryToken, setOptionsRetryToken] = useState(0);
  const [readinessRetry, setReadinessRetry] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // «Editar vuelo», «Cancelar vuelo» or «Marcar desviado» of one flight (3-A).
  const [changeRequest, setChangeRequest] = useState(null);
  const assignment = usePlanningAssignment();
  const { toasts, showToast, dismissToast } = useToast();
  const { t } = useTranslation(planningMessages);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'planningError';
  const isUnauthorized = status === 'unauthorized' && forceState === 'default';
  const isForbidden = status === 'forbidden' && forceState === 'default';
  const readiness = useAssignmentReadiness({
    stationId: data?.station?.id, date: data?.date, refreshToken: dataRevision + readinessRetry,
    enabled: status === 'success' && forceState === 'default',
  });
  const baseFlights = forceState === 'planningEmpty' ? NO_FLIGHTS : data?.flights ?? NO_FLIGHTS;
  // 2-N25: the board marks an assigned agent who cannot do the operation on its date.
  const flights = useMemo(() => withAssignmentReadiness(baseFlights, readiness.marks), [baseFlights, readiness.marks]);
  const stableFilterScopeKey = filterScopeKey ?? `${selectedStationId}|${selectedDate}`;
  const { filters, setFilter, quickFilter, setQuickFilter, resetFilters, filteredFlights } = usePlanningFilters(flights, stableFilterScopeKey);
  const displayedFlights = forceState === 'planningNoResults' ? [] : filteredFlights;
  const kpis = computeKpis(flights);
  const options = getFilterOptions(flights);
  const selectedFlight = flights.find(flight => flight.id === selectedFlightId) ?? null;
  const canLoadAssignmentOptions = isInitialAssignmentCandidate(selectedFlight);
  const planningOptions = usePlanningOptions({
    turnaroundId: selectedFlight?.turnaroundId,
    refreshToken: optionsRetryToken + dataRevision,
    enabled: canLoadAssignmentOptions,
  });

  const canCreate = hasStationScope && Boolean(selectedStationId) &&
    ['success', 'empty'].includes(status) && forceState === 'default';
  let todayAtStation;
  try {
    todayAtStation = new Intl.DateTimeFormat('sv-SE', {
      timeZone: data?.station?.ianaTimeZone ?? 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    todayAtStation = new Date().toISOString().slice(0, 10);
  }
  const createDate = selectedDate && selectedDate >= todayAtStation ? selectedDate : todayAtStation;

  useEffect(() => {
    if (selectedFlightId && !flights.some(flight => flight.id === selectedFlightId)) {
      setSelectedFlightId(null);
    }
  }, [flights, selectedFlightId]);

  useEffect(() => {
    if (!canCreate) setShowCreate(false);
  }, [canCreate]);

  function selectFlight(flightId) {
    assignment.reset();
    setOptionsRetryToken(0);
    setSelectedFlightId(flightId);
  }

  async function assignOperation(agentId) {
    if (!selectedFlight || !planningOptions.etag) return;

    const selectedAgent = planningOptions.data?.agents.find(agent => agent.id === agentId);
    const outcome = await assignment.assign({
      turnaroundId: selectedFlight.turnaroundId,
      agentId,
      etag: planningOptions.etag,
    });

    if (outcome.detached) return;

    if (outcome.ok) {
      const agentName = selectedAgent?.displayName ?? t('page.selectedAgent');
      setSelectedFlightId(null);
      assignment.reset();
      onRetry();
      showToast(t('page.assigned', { agent: agentName }), 'success');
      return;
    }

    if (outcome.refreshRequired) {
      setSelectedFlightId(null);
      setOptionsRetryToken(0);
      assignment.reset();
      onRetry();
    }

    if (outcome.error?.message) {
      showToast(outcome.error.message, 'danger', 6500);
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-4">
      <PlanningHeader onRefresh={onRetry} onCreate={() => setShowCreate(true)} canCreate={canCreate}
        onImport={() => setShowImport(true)} canImport={hasStationScope && Boolean(selectedStationId) && Boolean(data?.date ?? selectedDate)} />

      {!hasStationScope ? (
        <NoStationScope />
      ) : isUnauthorized ? (
        <StatePanel kind="unauthorized" />
      ) : isForbidden ? (
        <StatePanel kind="forbidden" />
      ) : isError ? (
        <StatePanel kind="error" onRetry={onRetry} />
      ) : (
        <>
          <PlanningFilters
            filters={filters}
            onFilterChange={setFilter}
            quickFilter={quickFilter}
            onQuickFilter={setQuickFilter}
            onReset={resetFilters}
            options={options}
            stationScopes={stationScopes}
            selectedStationId={selectedStationId}
            onStationChange={onStationChange}
            selectedDate={selectedDate}
            onDateChange={onDateChange}
            loading={isLoading}
          />

          <PlanningKPIs kpis={kpis} loading={isLoading} />
          {readiness.status === 'error' && !isLoading && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-status-warning/30 bg-status-warning/10 px-4 py-2 text-xs">
              <span>{t('page.readinessUnavailable')}</span>
              <button type="button" onClick={() => setReadinessRetry(value => value + 1)}
                className="rounded-lg border border-status-warning/40 px-3 py-1 font-semibold">{t('page.readinessRetry')}</button>
            </div>
          )}
          <ViewSwitcher active={activeView} onChange={setActiveView} />

          {isLoading ? (
            <PlanningSkeleton />
          ) : activeView === 'map' ? (
            <PlanningMap stationId={selectedStationId} date={data?.date ?? selectedDate} flights={flights}
              timeZone={data?.station?.ianaTimeZone} onSelectFlight={selectFlight} dataRevision={dataRevision} />
          ) : activeView !== 'timeline' ? (
            <ModulePlaceholder icon={CalendarIcon} label={t(activeView === 'table' ? 'page.tableView' : 'page.calendarView')} description={t('page.viewComingSoon')} />
          ) : displayedFlights.length === 0 ? (
            <EmptyPlanningState reason={flights.length === 0 ? 'no-flights' : 'no-results'} />
          ) : (
            <FlightTimeline
              flights={displayedFlights}
              now={now}
              timeZone={data?.station?.ianaTimeZone}
              onSelectFlight={selectFlight}
            />
          )}
        </>
      )}

      <PlanningDrawer
        flight={selectedFlight}
        dataRevision={dataRevision}
        onClose={() => {
          assignment.reset();
          setSelectedFlightId(null);
        }}
        optionsState={selectedFlight ? planningOptions : EMPTY_OPTIONS_STATE}
        assignmentState={assignment}
        onAssign={assignOperation}
        onRetryOptions={() => setOptionsRetryToken(token => token + 1)}
        onShiftProgrammed={kind => {
          assignment.reset();
          setOptionsRetryToken(token => token + 1);
          // 3-E: «Ajustar turno del día» widened the shift the agent already had instead of programming another one.
          showToast(t(kind === 'adjusted' ? 'page.shiftAdjusted' : 'page.shiftProgrammed'), 'success');
        }}
        onAgentReleased={() => {
          assignment.reset();
          setOptionsRetryToken(token => token + 1);
          // The operation is Planned again: the board re-reads it so the panel offers another agent (3-C).
          onRetry();
          showToast('Agente liberado. Ya puedes asignar a otro.', 'success');
        }}
        onAgentHandedOver={name => {
          // 3-F: the operation keeps its status with the new agent; the board re-reads who works it.
          assignment.reset();
          setOptionsRetryToken(token => token + 1);
          onRetry();
          showToast(t('drawer.handoverDone', { name }), 'success');
        }}
        onStale={() => {
          // A 409 on the agent's commands: the board and the options are read again before a new intent (3-J).
          assignment.reset();
          setOptionsRetryToken(token => token + 1);
          onRetry();
        }}
        onChangeFlight={mode => {
          if (!selectedFlight?.turnaroundId) return;
          assignment.reset();
          setChangeRequest({ turnaroundId: selectedFlight.turnaroundId, mode });
          setSelectedFlightId(null);
        }}
      />
      {changeRequest && (
        <TurnaroundChangeDialog key={`${changeRequest.turnaroundId}|${changeRequest.mode}`}
          turnaroundId={changeRequest.turnaroundId} mode={changeRequest.mode}
          onClose={() => setChangeRequest(null)}
          onChanged={(mode, operationCode) => {
            setChangeRequest(null);
            onRetry();
            showToast(t(CHANGE_TOASTS[mode], { code: operationCode }), 'success');
          }} />
      )}
      {showCreate && canCreate && (
        <ManualTurnaroundDialog key={selectedStationId} stationId={selectedStationId}
          initialDate={createDate} onClose={() => setShowCreate(false)}
          onCreated={(date, operationCode) => {
            setShowCreate(false);
            if (date === selectedDate) onRetry();
            else onDateChange?.(date);
            showToast(t('page.flightCreated', { code: operationCode }), 'success');
          }} />
      )}
      {showImport && selectedStationId && (data?.date ?? selectedDate) && (
        <ProviderFlightsDialog stationId={selectedStationId} date={data?.date ?? selectedDate} timeZone={data?.station?.ianaTimeZone}
          revision={dataRevision} onClose={() => setShowImport(false)} onImported={onRetry} />
      )}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
