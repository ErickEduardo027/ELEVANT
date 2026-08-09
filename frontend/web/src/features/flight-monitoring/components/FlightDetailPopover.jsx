import StatusBadge from '../../dashboard/components/StatusBadge';
import { formatClockTime } from '../../dashboard/mappers';
import { formatRemaining } from '../flightMonitoringMappers';
import { XIcon } from './icons';

export default function FlightDetailPopover({ flight, now, style, onClose }) {
  if (!flight) return null;

  return (
    <div
      data-testid="flight-detail-popover"
      role="dialog"
      aria-label={`Detalle del vuelo ${flight.flightNumber}`}
      style={style}
      className="absolute z-20 w-72 space-y-2 rounded-2xl border border-black/10 bg-white/95 p-4 text-sm shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
            {flight.flightNumber} · {flight.airline}
          </p>
          <StatusBadge domain="flight" status={flight.status} />
        </div>
        <button
          type="button"
          aria-label="Cerrar detalle"
          onClick={onClose}
          className="rounded-md p-1 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <p className="text-text-secondary-light dark:text-text-secondary-dark">
        {flight.origin} → {flight.destination} · {flight.aircraft} · {flight.registration}
      </p>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <dt>ETA</dt>
        <dd>{formatClockTime(flight.eta)}</dd>
        <dt>ETD</dt>
        <dd>{formatClockTime(flight.etd)}</dd>
        <dt>Hora real</dt>
        <dd>
          {flight.actualArrival ?? flight.actualDeparture
            ? formatClockTime(flight.actualArrival ?? flight.actualDeparture)
            : 'Pendiente'}
        </dd>
        <dt>Altitud</dt>
        <dd>{flight.altitude.toLocaleString('en-US')} ft</dd>
        <dt>Velocidad</dt>
        <dd>{flight.speed} kt</dd>
        <dt>Heading</dt>
        <dd>{flight.heading}°</dd>
        <dt>Stand</dt>
        <dd>{flight.stand ?? 'Sin asignar'}</dd>
        <dt>Supervisor</dt>
        <dd>{flight.supervisor ?? 'Sin asignar'}</dd>
        <dt>Agentes</dt>
        <dd>{flight.agents}</dd>
        <dt>Tiempo restante</dt>
        <dd>{formatRemaining(flight.eta, now)}</dd>
      </dl>

      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
        Servicios: {flight.services.length > 0 ? flight.services.join(', ') : 'Sin servicios registrados'}
      </p>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled
          title="Próximamente"
          className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
        >
          Ver planificación
        </button>
        <button
          type="button"
          disabled
          title="Próximamente"
          className="cursor-not-allowed rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-text-secondary-light/60 dark:border-white/10 dark:text-text-secondary-dark/60"
        >
          Ver mapa de posiciones
        </button>
      </div>
    </div>
  );
}
