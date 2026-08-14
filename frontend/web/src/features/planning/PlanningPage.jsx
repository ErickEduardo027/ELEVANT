import { useEffect, useState } from 'react';
import PlanningHeader from './components/PlanningHeader';
import PlanningFilters from './components/PlanningFilters';
import PlanningKPIs from './components/PlanningKPIs';
import ViewSwitcher from './components/ViewSwitcher';
import FlightTimeline from './components/FlightTimeline';
import PlanningDrawer from './components/PlanningDrawer';
import PlanningSkeleton from './components/PlanningSkeleton';
import EmptyPlanningState from './components/EmptyPlanningState';
import ModulePlaceholder from '../shell/components/ModulePlaceholder';
import { CalendarIcon } from '../shell/components/icons';
import { usePlanningFilters } from './usePlanningFilters';
import { computeKpis, getFilterOptions } from './planningMappers';
import FlightPlanningModal from './components/FlightPlanningModal';
import AssignmentModal from './components/AssignmentModal';

export default function PlanningPage({ status, data, error, onRetry, forceState = 'default' }) {
  const [activeView, setActiveView] = useState('timeline');
  const [selectedFlightId, setSelectedFlightId] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [creating, setCreating] = useState(false);
  const [assigningFlight, setAssigningFlight] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'planningError';

  const flights = forceState === 'planningEmpty' ? [] : data?.flights ?? [];
  const { filters, setFilter, quickFilter, setQuickFilter, filteredFlights } = usePlanningFilters(flights);
  const displayedFlights = forceState === 'planningNoResults' ? [] : filteredFlights;

  const kpis = computeKpis(flights);
  const options = getFilterOptions(flights);
  const selectedFlight = flights.find(flight => flight.id === selectedFlightId) ?? null;

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">
          No se pudo cargar la planificación operativa de la estación.
        </p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <PlanningHeader onRefresh={onRetry} onNewFlight={() => setCreating(true)} />

      <PlanningFilters
        filters={filters}
        onFilterChange={setFilter}
        quickFilter={quickFilter}
        onQuickFilter={setQuickFilter}
        options={options}
      />

      <PlanningKPIs kpis={kpis} loading={isLoading} />

      <ViewSwitcher active={activeView} onChange={setActiveView} />

      {isLoading ? (
        <PlanningSkeleton />
      ) : activeView !== 'timeline' ? (
        <ModulePlaceholder
          icon={CalendarIcon}
          label={activeView === 'table' ? 'Vista de tabla' : 'Vista de calendario'}
          description="Esta vista estará disponible en una próxima iteración del módulo."
        />
      ) : displayedFlights.length === 0 ? (
        <EmptyPlanningState reason={flights.length === 0 ? 'no-flights' : 'no-results'} />
      ) : (
        <FlightTimeline flights={displayedFlights} now={now} onSelectFlight={setSelectedFlightId} />
      )}

      <PlanningDrawer flight={selectedFlight} onClose={() => setSelectedFlightId(null)} onAssign={flight => setAssigningFlight(flight)} />
      <FlightPlanningModal open={creating} onClose={() => setCreating(false)} onCreated={onRetry} />
      <AssignmentModal flight={assigningFlight} onClose={() => setAssigningFlight(null)} onAssigned={() => { setSelectedFlightId(null); onRetry(); }} />
    </div>
  );
}
