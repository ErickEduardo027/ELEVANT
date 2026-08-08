import ReviewSection from '../../review/components/ReviewSection';
import { formatClockTime } from '../../review/reviewMappers';
import { formatSignedMinutes } from '../reportsMappers';

function InfoGrid({ items }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {items.map(item => (
        <div key={item.label}>
          <dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{item.label}</dt>
          <dd className="font-medium text-ink-900 dark:text-text-primary-dark">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Detalle de solo lectura reutilizado por los tres reportes tabulares (Cierre
// operacional, Conciliación de servicios y Tiempo en tierra). No incluye acciones
// de aprobación/devolución — esas son exclusivas del módulo Revisión.
export default function ReportDetailPanel({ record }) {
  if (!record) return null;

  return (
    <div className="space-y-4">
      <ReviewSection title="Información del vuelo">
        <InfoGrid
          items={[
            { label: 'Vuelo', value: record.flight.number },
            { label: 'Aerolínea', value: record.flight.airline },
            { label: 'Terminal', value: record.terminal },
            { label: 'Tipo de aeronave', value: record.aircraftType },
            { label: 'Posición asignada', value: record.position.assigned },
            { label: 'Posición final', value: record.position.final },
            { label: 'Agente', value: record.agent?.name ?? 'Sin asignar' },
          ]}
        />
      </ReviewSection>

      {record.positionChange && (
        <ReviewSection title="Cambio de posición">
          <InfoGrid
            items={[
              { label: 'Recibido', value: formatClockTime(record.positionChange.changeReceivedAt) },
              { label: 'Bloqueo real', value: formatClockTime(record.actualBlockAt) },
            ]}
          />
        </ReviewSection>
      )}

      <ReviewSection title="Tiempo en tierra">
        <InfoGrid
          items={[
            { label: 'Contratado', value: `${record.groundTime.contractedMinutes} min` },
            { label: 'Real', value: `${record.groundTime.actualMinutes} min` },
            { label: 'Diferencia', value: formatSignedMinutes(record.groundTime.actualMinutes - record.groundTime.contractedMinutes) },
          ]}
        />
      </ReviewSection>

      <ReviewSection title="Servicios">
        {record.services.length === 0 ? (
          <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin servicios registrados.</p>
        ) : (
          <ul className="space-y-1">
            {record.services.map(service => (
              <li key={service.name} className="flex items-center justify-between gap-3">
                <span>{service.name}</span>
                <span className="font-mono text-text-secondary-light dark:text-text-secondary-dark">
                  {service.contractedQty} contratado{service.contractedQty === 1 ? '' : 's'} · {service.executedQty} ejecutado
                  {service.executedQty === 1 ? '' : 's'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ReviewSection>

      <ReviewSection title="Incidencias">
        {record.incidents > 0 ? (
          <p>
            {record.incidents} incidencia{record.incidents === 1 ? '' : 's'} reportada{record.incidents === 1 ? '' : 's'} durante la
            operación.
          </p>
        ) : (
          <p className="text-text-secondary-light dark:text-text-secondary-dark">Sin incidencias reportadas.</p>
        )}
      </ReviewSection>
    </div>
  );
}
