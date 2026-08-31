import { useState } from 'react';
import { useSchedulesData } from './useSchedulesData';
import { useWeekNavigation } from './useWeekNavigation';
import { useScheduleFilters } from './useScheduleFilters';
import { useDisclosure } from '../../../hooks/useDisclosure';
import { useToast } from '../../../hooks/useToast';
import Toast from '../../../components/Toast';
import Tabs from '../../../components/Tabs';
import { RefreshCwIcon } from '../../shell/components/icons';
import { filterShiftsByWeek, deriveScheduleKpis } from './mappers';
import ScheduleSummary from './components/ScheduleSummary';
import ScheduleFilters from './components/ScheduleFilters';
import ShiftCalendar from './components/ShiftCalendar';
import ShiftAssignmentModal from './components/ShiftAssignmentModal';
import CoverageByPositionView from './components/CoverageByPositionView';
import AvailabilityRequestsPanel from './components/AvailabilityRequestsPanel';

const TABS = [
  { id: 'calendar', label: 'Calendario de turnos' },
  { id: 'coverage', label: 'Cobertura por posición' },
  { id: 'requests', label: 'Solicitudes de disponibilidad' },
];

const WEEK_TRANSITION_CLASS = {
  next: 'motion-safe:animate-slide-in-right',
  previous: 'motion-safe:animate-slide-in-left',
};

// Composición del módulo "Horarios y disponibilidad". La Topbar y el
// Sidebar de Gestión Humana ya existen (AppShell); este componente solo
// aporta el contenido del área principal, igual que PermitsPage/
// CertificationsPage. Toda la lectura/escritura de datos pasa por
// useSchedulesData (que a su vez delega en humanResourcesSchedulesService)
// — este archivo no importa el servicio directamente.
export default function SchedulesPage() {
  const {
    status,
    agents,
    positions,
    shiftBlocks,
    coverageRequirements,
    shifts,
    availabilityRequests,
    shiftsByAgentDate,
    approvedRestrictionsByAgentDate,
    positionsById,
    error,
    refresh,
    validateAssignment,
    saveShiftAssignment,
    removeShift,
    resolveRequest,
  } = useSchedulesData();

  const { weekDays, weekRangeLabel, direction, isCurrentWeek, goToPreviousWeek, goToNextWeek, goToToday } = useWeekNavigation();
  const { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredAgents } = useScheduleFilters(agents);
  const { toasts, showToast, dismissToast } = useToast();

  const [activeTab, setActiveTab] = useState('calendar');
  const [modalContext, setModalContext] = useState(null);
  const shiftModal = useDisclosure();

  const isLoading = status === 'loading';
  const isError = status === 'error';

  const weekShifts = filterShiftsByWeek(shifts, weekDays);
  const kpis = deriveScheduleKpis(weekShifts, weekDays, coverageRequirements, positionsById);
  const agentOptions = agents.map(agent => ({ value: agent.agentId, label: agent.agentName }));

  function openShiftModal(agent, dateKey, existingShift) {
    setModalContext({ agent, dateKey, existingShift });
    shiftModal.open();
  }

  async function handleSubmitShift(payload) {
    await saveShiftAssignment(payload);
    showToast(payload.id ? 'Turno actualizado correctamente.' : 'Turno asignado correctamente.', 'success');
  }

  async function handleRemoveShift(shiftId) {
    await removeShift(shiftId);
    showToast('Turno eliminado.', 'success');
  }

  async function handleApproveRequest(requestId) {
    await resolveRequest(requestId, 'approved');
    showToast('Solicitud aprobada.', 'success');
  }

  async function handleRejectRequest(requestId) {
    await resolveRequest(requestId, 'rejected');
    showToast('Solicitud rechazada.', 'success');
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar los horarios y la disponibilidad.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Horarios y disponibilidad</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Turnos rotativos de 8 horas, disponibilidad, asignación por terminal y posición, y cobertura de personal.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          aria-label="Actualizar"
          className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" /> Actualizar
        </button>
      </div>

      <ScheduleSummary kpis={kpis} loading={isLoading} />

      <Tabs tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      <div key={activeTab} className="animate-fade-in space-y-4">
        {activeTab === 'calendar' && (
          <>
            <ScheduleFilters
              weekRangeLabel={weekRangeLabel}
              isCurrentWeek={isCurrentWeek}
              onPreviousWeek={goToPreviousWeek}
              onNextWeek={goToNextWeek}
              onToday={goToToday}
              filters={filters}
              onFilterChange={onFilterChange}
              onResetFilters={onResetFilters}
              hasActiveFilters={hasActiveFilters}
              agentOptions={agentOptions}
            />
            <div key={weekDays[0]?.dateKey} className={direction ? WEEK_TRANSITION_CLASS[direction] : ''}>
              <ShiftCalendar
                agents={filteredAgents}
                weekDays={weekDays}
                shiftsByAgentDate={shiftsByAgentDate}
                positionsById={positionsById}
                approvedRestrictionsByAgentDate={approvedRestrictionsByAgentDate}
                loading={isLoading}
                hasActiveFilters={hasActiveFilters}
                onCellClick={openShiftModal}
              />
            </div>
          </>
        )}

        {activeTab === 'coverage' && (
          <CoverageByPositionView
            weekDays={weekDays}
            shifts={shifts}
            coverageRequirements={coverageRequirements}
            positionsById={positionsById}
            shiftBlocks={shiftBlocks}
            loading={isLoading}
          />
        )}

        {activeTab === 'requests' && (
          <AvailabilityRequestsPanel
            requests={availabilityRequests}
            loading={isLoading}
            onApprove={handleApproveRequest}
            onReject={handleRejectRequest}
          />
        )}
      </div>

      <ShiftAssignmentModal
        open={shiftModal.isOpen}
        context={modalContext}
        shiftBlocks={shiftBlocks}
        positions={positions}
        validateAssignment={validateAssignment}
        onClose={shiftModal.close}
        onSubmit={handleSubmitShift}
        onRemove={handleRemoveShift}
      />

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
