import DataTable from '../../../../components/DataTable';
import Avatar from '../../../../components/Avatar';
import EmptyState from '../../../../components/EmptyState';
import ShiftCell from './ShiftCell';
import { CalendarIcon } from '../../../shell/components/icons';

function DayHeader({ day }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[10px] uppercase tracking-wide">{day.weekdayLabel}</span>
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-xs ${
          day.isToday ? 'bg-accent-600 text-white' : 'text-ink-900 dark:text-text-primary-dark'
        }`}
      >
        {day.dayLabel}
      </span>
    </div>
  );
}

// Grilla semanal de turnos (skill.md §"CALENDARIO DE TURNOS": columnas =
// días, filas = agentes). Reutiliza DataTable en vez de un <table> propio
// — cada día es una columna declarativa cuyo `render` delega en ShiftCell;
// se fija `pageSize` alto porque paginar filas de agentes rompería la
// lectura semanal de un calendario (a diferencia de una tabla de registros).
export default function ShiftCalendar({ agents, weekDays, shiftsByAgentDate, positionsById, approvedRestrictionsByAgentDate, loading, hasActiveFilters, onCellClick }) {
  const columns = [
    {
      key: 'agent',
      label: 'Agente',
      className: 'sticky left-0 z-10 bg-surface-light-card dark:bg-surface-dark',
      render: agent => (
        <div className="flex min-w-[160px] items-center gap-2.5">
          <Avatar name={agent.agentName} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-text-primary-dark">{agent.agentName}</p>
            <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {agent.employeeNumber} · Terminal {agent.terminals.join('/')}
            </p>
          </div>
        </div>
      ),
    },
    ...weekDays.map(day => ({
      key: day.dateKey,
      label: <DayHeader day={day} />,
      className: `text-center ${day.isToday ? 'bg-accent-600/5' : ''}`,
      render: agent => {
        const shift = shiftsByAgentDate.get(`${agent.agentId}|${day.dateKey}`) ?? null;
        const restriction = !shift ? (approvedRestrictionsByAgentDate.get(`${agent.agentId}|${day.dateKey}`) ?? null) : null;
        return (
          <ShiftCell
            shift={shift}
            positionName={shift?.positionId ? (positionsById.get(shift.positionId)?.name ?? shift.positionId) : null}
            restriction={restriction}
            onClick={() => onCellClick(agent, day.dateKey, shift)}
          />
        );
      },
    })),
  ];

  return (
    <DataTable
      columns={columns}
      rows={agents}
      getRowId={agent => agent.agentId}
      loading={loading}
      pageSize={100}
      emptyState={
        <EmptyState
          icon={CalendarIcon}
          title={hasActiveFilters ? 'No hay agentes que coincidan con los filtros.' : 'No hay agentes para mostrar.'}
          description={hasActiveFilters ? 'Ajusta o limpia los filtros para ver más resultados.' : 'El personal de rampa aparecerá aquí.'}
        />
      }
    />
  );
}
