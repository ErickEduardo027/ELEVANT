// What a map screen shows when the engine cannot draw (no WebGL2, or a map that failed to start): the screen's own
// title and description, and the stands or flights of the map as a list to keep working with. Each adapter passes
// its own strings, so today's texts stay as they are.
export default function MapUnavailable({ title, description, listLabel, items = [], selectedId = null, onSelect }) {
  return (
    <div role="alert" data-testid="map-unavailable" className="absolute inset-0 z-20 overflow-y-auto bg-occ-panel p-5 text-occ-text">
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-prose text-sm text-occ-muted">{description}</p>}
      {items.length > 0 && (
        <div role="group" aria-label={listLabel} className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">
          {items.map(item => {
            const selected = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect?.(item.id, item)}
                className={`min-h-11 rounded border px-2 py-2 font-mono text-sm font-semibold ${selected
                  ? 'border-occ-accent bg-occ-accent-soft text-occ-text'
                  : 'border-occ-line bg-occ-panel-raised text-occ-text hover:border-occ-line-strong'}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
