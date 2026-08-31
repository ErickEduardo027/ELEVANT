import { useState } from 'react';
import { POSITION_STATUS_META, STATUS_COLORS } from '../../dashboard/statusMeta';
import { ChevronDownIcon } from '../../dashboard/components/icons';

export default function PositionLegend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="absolute bottom-4 left-4 z-10 w-64 rounded-xl border border-black/10 bg-white/90 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
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
        <>
          <ul className="mt-2 space-y-1.5">
            {Object.entries(POSITION_STATUS_META).map(([status, meta]) => (
              <li key={status} className="flex items-center gap-2 text-text-secondary-light dark:text-text-secondary-dark">
                <span
                  className="h-2.5 w-3.5 shrink-0 rounded-sm border"
                  style={{
                    borderColor: STATUS_COLORS[meta.color],
                    backgroundColor: `${STATUS_COLORS[meta.color]}2E`,
                    borderStyle: status === 'disabled' ? 'dashed' : 'solid',
                  }}
                  aria-hidden="true"
                />
                {meta.label}
              </li>
            ))}
          </ul>

          <div className="mt-3 border-t border-black/5 pt-2 dark:border-white/5">
            <p className="font-semibold text-ink-900 dark:text-text-primary-dark">Configuración combinada</p>
            <svg viewBox="0 0 120 28" className="mt-1.5 h-6 w-full" aria-hidden="true">
              <rect x="4" y="6" width="26" height="16" rx="2" fill={`${STATUS_COLORS.info}2E`} stroke={STATUS_COLORS.info} strokeWidth="1.5" />
              <line x1="30" y1="14" x2="90" y2="14" stroke={STATUS_COLORS.danger} strokeWidth="1.5" strokeDasharray="3 2" />
              <rect
                x="90"
                y="6"
                width="26"
                height="16"
                rx="2"
                fill={`${STATUS_COLORS.danger}2E`}
                stroke={STATUS_COLORS.danger}
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
            </svg>
            <p className="mt-1 text-text-secondary-light dark:text-text-secondary-dark">
              Una posición activa en configuración Alfa/Bravo inhabilita automáticamente a su posición adyacente vinculada.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
