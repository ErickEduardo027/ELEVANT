import ReviewSection from './ReviewSection';
import { formatClockTime } from '../reviewMappers';

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{label}</dt>
      <dd className="font-medium text-ink-900 dark:text-text-primary-dark">{value || 'Sin registro'}</dd>
    </div>
  );
}

export default function FlightInfoSection({ operation }) {
  const { flight, schedule, position } = operation;

  return (
    <ReviewSection title="Datos del vuelo">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Número de vuelo" value={flight.number} />
        <Field label="Aerolínea" value={flight.airline} />
        <Field label="Origen" value={flight.origin} />
        <Field label="Destino" value={flight.destination} />
        <Field label="Tipo de aeronave" value={flight.aircraftType} />
        <Field label="Matrícula" value={flight.registration} />
        <Field label="STA" value={formatClockTime(schedule?.sta)} />
        <Field label="ATA" value={formatClockTime(schedule?.ata)} />
        <Field label="STD" value={formatClockTime(schedule?.std)} />
        <Field label="ATD" value={formatClockTime(schedule?.atd)} />
        <Field label="Posición" value={position} />
      </dl>
    </ReviewSection>
  );
}
