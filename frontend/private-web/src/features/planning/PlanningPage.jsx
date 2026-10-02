import { useEffect, useState } from 'react';
import PlanningHeader from './components/PlanningHeader';
import PlanningFilters from './components/PlanningFilters';
import PlanningKPIs from './components/PlanningKPIs';
import ViewSwitcher from './components/ViewSwitcher';
import FlightTimeline from './components/FlightTimeline';
import PlanningDrawer from './components/PlanningDrawer';
import PlanningSkeleton from './components/PlanningSkeleton';
import ManualTurnaroundDialog from './components/ManualTurnaroundDialog';
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
} from './planningMappers';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/Toast';

const EMPTY_OPTIONS_STATE = {
  status: 'idle',
  data: null,
  etag: null,
  error: null,
  reason: null,
  recoverable: false,
};

function StatePanel({ kind, onRetry }) {
  const unauthorized = kind === 'unauthorized';
  const forbidden = kind === 'forbidden';
  return (
    <div role={unauthorized ? 'status' : 'alert'} className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card">
      <p className="text-sm font-semibold text-status-danger">
        {unauthorized
          ? 'La sesión ya no está disponible.'
          : forbidden
            ? 'No tiene permiso para consultar esta planificación.'
            : 'No se pudo cargar la planificación operativa.'}
      </p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {unauthorized
          ? 'Será redirigido al acceso para iniciar una sesión nueva.'
          : forbidden
            ? 'Solicite al administrador que revise su rol y alcance de estación.'
            : 'Compruebe la conexión e intente nuevamente.'}
      </p>
      {!unauthorized && !forbidden && (
        <button type="button" onClick={onRetry} className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90">Reintentar</button>
      )}
    </div>
  );
}

function NoStationScope() {
  return (
    <div role="status" className="rounded-2xl border border-status-warning/30 bg-status-warning/10 p-6">
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Sin estaciones habilitadas</p>
      <p className="mt-2 max-w-2xl text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Su cuenta no tiene un alcance de estación activo. Solicite al administrador que revise sus permisos antes de consultar la operación.
      </p>
    </div>
  );
}

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
  const [showCreate, setShowCreate] = useState(false);
  const assignment = usePlanningAssignment();
  const { toasts, showToast, dismissToast } = useToast();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'planningError';
  const isUnauthorized = status === 'unauthorized' && forceState === 'default';
  const isForbidden = status === 'forbidden' && forceState === 'default';
  const flights = forceState === 'planningEmpty' ? [] : data?.flights ?? [];
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
      const agentName = selectedAgent?.displayName ?? 'el agente seleccionado';
      setSelectedFlightId(null);
      assignment.reset();
      onRetry();
      showToast(`Operación asignada a ${agentName}.`, 'success');
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
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PlanningHeader onRefresh={onRetry} onCreate={() => setShowCreate(true)} canCreate={canCreate} />

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
          <ViewSwitcher active={activeView} onChange={setActiveView} />

          {isLoading ? (
            <PlanningSkeleton />
          ) : activeView !== 'timeline' ? (
            <ModulePlaceholder icon={CalendarIcon} label={activeView === 'table' ? 'Vista de tabla' : 'Vista de calendario'} description="Esta vista estará disponible en una próxima iteración del módulo." />
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
        onClose={() => {
          assignment.reset();
          setSelectedFlightId(null);
        }}
        optionsState={selectedFlight ? planningOptions : EMPTY_OPTIONS_STATE}
        assignmentState={assignment}
        onAssign={assignOperation}
        onRetryOptions={() => setOptionsRetryToken(token => token + 1)}
        onShiftProgrammed={() => {
          assignment.reset();
          setOptionsRetryToken(token => token + 1);
          showToast('Turno programado. Actualizando elegibilidad antes de asignar.', 'success');
        }}
      />
      {showCreate && canCreate && (
        <ManualTurnaroundDialog key={selectedStationId} stationId={selectedStationId}
          initialDate={createDate} onClose={() => setShowCreate(false)}
          onCreated={(date, operationCode) => {
            setShowCreate(false);
            if (date === selectedDate) onRetry();
            else onDateChange?.(date);
            showToast(`Vuelo ${operationCode} creado. Puede asignar la operación desde esta planificación.`, 'success');
          }} />
      )}
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
