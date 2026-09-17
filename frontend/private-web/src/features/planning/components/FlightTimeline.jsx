import FlightCard from './FlightCard';
import { groupFlightsByHour } from '../planningMappers';

export default function FlightTimeline({ flights, now, timeZone, onSelectFlight }) {
  const effectiveTimeZone = timeZone ?? flights.find(flight => flight.station?.ianaTimeZone)?.station.ianaTimeZone;
  const groups = groupFlightsByHour(flights, effectiveTimeZone);

  return (
    <div data-testid="flight-timeline" className="space-y-4">
      {groups.map(group => (
        <div key={group.hourLabel} className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            <span>{group.hourLabel}</span>
            <span className="h-px flex-1 bg-black/5 dark:bg-white/5" />
          </div>
          <div className="space-y-2">
            {group.flights.map(flight => (
              <FlightCard key={flight.id} flight={flight} now={now} onSelect={onSelectFlight} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
