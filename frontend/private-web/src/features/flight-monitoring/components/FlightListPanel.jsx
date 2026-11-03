import FlightSearch from './FlightSearch';
import FlightFilterChips from './FlightFilterChips';
import FlightListItem from './FlightListItem';
import EmptyFlightState from './EmptyFlightState';

export default function FlightListPanel({
  flights,
  emptyReason,
  search,
  onSearchChange,
  activeChip,
  onChipChange,
  selectedFlightId,
  onSelectFlight,
}) {
  return (
    <div
      data-testid="flight-list-panel"
      data-occ-surface=""
      className="flex h-full flex-col gap-3 overflow-y-auto rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      <FlightSearch value={search} onChange={onSearchChange} />
      <FlightFilterChips active={activeChip} onChange={onChipChange} />

      {emptyReason ? (
        <EmptyFlightState reason={emptyReason} />
      ) : (
        <div className="flex flex-col gap-2">
          {flights.map(flight => (
            <FlightListItem
              key={flight.id}
              flight={flight}
              selected={flight.id === selectedFlightId}
              onSelect={onSelectFlight}
            />
          ))}
        </div>
      )}
    </div>
  );
}
