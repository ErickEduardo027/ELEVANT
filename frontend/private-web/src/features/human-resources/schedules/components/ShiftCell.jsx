import { PlusIcon, UserMinusIcon } from '../../../shell/components/icons';
import { TERMINAL_ACCENT_META } from '../statusMeta';
import { formatTimeRange } from '../mappers';

// Celda del calendario semanal (skill.md §"CALENDARIO DE TURNOS"). Tres
// estados visuales distintos, ninguno resuelto solo por color para que
// sigan siendo legibles en modo oscuro y para daltonismo:
//   - turno asignado: chip con borde de acento por terminal + horario.
//   - "no disponible" (solicitud aprobada ese día): patrón de rayas
//     diagonales sutil + ícono, nunca el mismo fondo plano que "sin turno".
//   - "sin turno": contorno punteado silencioso, con un "+" que solo
//     aparece al pasar el mouse/foco (afordancia, no ruido visual).
export default function ShiftCell({ shift, positionName, restriction, onClick }) {
  const label = shift
    ? `Turno de ${shift.agentName}: ${formatTimeRange(shift.startTime, shift.endTime)}, Terminal ${shift.terminal}${positionName ? `, ${positionName}` : ''}. Clic para editar.`
    : restriction
      ? `${restriction.agentName} no disponible este día: ${restriction.reason}. Clic para asignar de todos modos.`
      : 'Sin turno asignado. Clic para asignar.';

  return (
    <button type="button" onClick={onClick} aria-label={label} className="block h-16 w-full min-w-[128px] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-600 rounded-lg">
      {shift ? (
        <div
          className={`flex h-full flex-col justify-center gap-0.5 rounded-lg border-l-2 bg-white/80 px-2 py-1.5 text-left shadow-sm transition-shadow hover:shadow-md dark:bg-white/5 ${TERMINAL_ACCENT_META[shift.terminal].borderClassName}`}
        >
          <span className="font-mono text-[11px] font-semibold tabular-nums text-ink-900 dark:text-text-primary-dark">
            {formatTimeRange(shift.startTime, shift.endTime)}
          </span>
          {positionName && (
            <span className="truncate text-[10px] text-text-secondary-light dark:text-text-secondary-dark">{positionName}</span>
          )}
          <span className="text-[10px] font-medium text-text-secondary-light dark:text-text-secondary-dark">
            {TERMINAL_ACCENT_META[shift.terminal].label}
          </span>
        </div>
      ) : restriction ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-black/10 bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.05)_0px,rgba(0,0,0,0.05)_4px,transparent_4px,transparent_8px)] py-2 text-text-secondary-light dark:border-white/10 dark:bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_4px,transparent_4px,transparent_8px)] dark:text-text-secondary-dark">
          <UserMinusIcon className="h-3.5 w-3.5 opacity-70" />
          <span className="text-[10px] font-medium">No disponible</span>
        </div>
      ) : (
        <div className="group flex h-full items-center justify-center rounded-lg border border-dashed border-black/10 text-text-secondary-light/0 transition-colors hover:border-accent-600/40 hover:bg-accent-600/5 hover:text-accent-600 dark:border-white/10 dark:hover:border-accent-600/40">
          <PlusIcon className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
      )}
    </button>
  );
}
