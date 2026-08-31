import { useEffect, useState } from 'react';
import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../dashboard/mappers';
import { formatRemaining } from '../flightMonitoringMappers';
import { XIcon } from './icons';

const EDITABLE_STATUSES = [
  ['scheduled', 'Programado'], ['delayed', 'Programado / Retrasado'],
  ['enRoute', 'En ruta'], ['landed', 'Aterrizó'], ['taxiing', 'Aterrizó / En rodaje'],
  ['arrived', 'Llegó al aeropuerto'], ['gateArrival', 'Llegó a la puerta'],
  ['cancelled', 'Cancelado'], ['diverted', 'Desviado'], ['unknown', 'Resultado desconocido'],
];

export default function FlightDetailPopover({ flight, now, style, onClose, onStatusChange }) {
  const [selectedStatus, setSelectedStatus] = useState(flight?.status ?? 'scheduled');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setSelectedStatus(flight?.status ?? 'scheduled'); setError(''); }, [flight?.id, flight?.status]);
  if (!flight) return null;

  const meta = getStatusMeta('flight', flight.status);

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
          <StatusBadge tone={meta.color} label={meta.label} />
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

      {onStatusChange && <div className="space-y-2 rounded-xl bg-accent-600/5 p-3">
        <label className="block text-xs font-semibold">Actualizar estado del vuelo
          <select value={selectedStatus} onChange={event => setSelectedStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-black/10 bg-white px-2 py-2 text-xs dark:border-white/10 dark:bg-surface-dark">
            {EDITABLE_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
        <button type="button" disabled={saving || selectedStatus === flight.status} onClick={async () => {
          setSaving(true); setError('');
          try { await onStatusChange(flight.id, selectedStatus); }
          catch (reason) { setError(reason?.message || 'No fue posible actualizar el estado.'); }
          finally { setSaving(false); }
        }} className="w-full rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {saving ? 'Guardando…' : 'Guardar estado'}
        </button>
      </div>}

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
