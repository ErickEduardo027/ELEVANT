import { useState } from 'react';
import { FLIGHT_STATUS_META, STATUS_COLORS } from '../../dashboard/statusMeta';
import { ChevronDownIcon } from '../../dashboard/components/icons';

export default function FlightLegend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-4 left-4 z-10 w-56 rounded-xl border border-black/10 bg-white/90 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
      <button
        type="button"
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between font-semibold text-ink-900 dark:text-text-primary-dark"
      >
        Leyenda
        <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`} />
      </button>
      {!collapsed && (
        <ul className="mt-2 space-y-1.5">
          {Object.entries(FLIGHT_STATUS_META).map(([status, meta]) => (
            <li key={status} className="flex items-center gap-2 text-text-secondary-light dark:text-text-secondary-dark">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: STATUS_COLORS[meta.color] }}
                aria-hidden="true"
              />
              {meta.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
