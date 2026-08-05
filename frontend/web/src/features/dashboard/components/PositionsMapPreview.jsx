import { MapPinIcon } from './icons';
import { RAMP_POSITIONS, projectRampPositions } from '../positionsData';

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 112;
const VIEW_PADDING = 16;
const STAND_WIDTH = 3.2;
const STAND_HEIGHT = 5.5;

function groupByTerminal(projected) {
  const groups = new Map();
  projected.forEach(point => {
    if (!groups.has(point.terminal)) groups.set(point.terminal, []);
    groups.get(point.terminal).push(point);
  });

  return Array.from(groups.entries()).map(([terminal, points]) => {
    const sorted = [...points].sort((a, b) => a.x - b.x);
    return {
      terminal,
      linePoints: sorted.map(p => `${p.x},${p.y}`).join(' '),
      labelX: sorted.reduce((sum, p) => sum + p.x, 0) / sorted.length,
      labelY: Math.max(Math.min(...sorted.map(p => p.y)) - 8, 8),
    };
  });
}

export default function PositionsMapPreview({ onOpenMap }) {
  const projected = projectRampPositions(RAMP_POSITIONS, {
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    padding: VIEW_PADDING,
  });
  const terminalGroups = groupByTerminal(projected);

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          <MapPinIcon className="h-4 w-4 text-accent-600" />
          Mapa de posiciones
        </h2>
        <button
          type="button"
          onClick={onOpenMap}
          className="text-xs font-medium text-accent-600 hover:underline"
        >
          Ver mapa completo
        </button>
      </div>

      <svg
        role="img"
        aria-label="Esquema simplificado de posiciones de la rampa de PUJ"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="h-28 w-full"
      >
        {terminalGroups.map(group => (
          <polyline
            key={`line-${group.terminal}`}
            points={group.linePoints}
            strokeWidth={1}
            className="fill-none stroke-ink-900/15 dark:stroke-white/20"
          />
        ))}

        {projected.map(point => (
          <rect
            key={point.id}
            data-testid="position-marker"
            x={point.x - STAND_WIDTH / 2}
            y={point.y - STAND_HEIGHT / 2}
            width={STAND_WIDTH}
            height={STAND_HEIGHT}
            rx={0.8}
            className="fill-accent-600/70 dark:fill-accent-600/80"
          />
        ))}

        {terminalGroups.map(group => (
          <text
            key={`label-${group.terminal}`}
            x={group.labelX}
            y={group.labelY}
            textAnchor="middle"
            className="fill-text-secondary-light font-mono text-[6px] font-medium dark:fill-text-secondary-dark"
          >
            {group.terminal}
          </text>
        ))}
      </svg>
    </div>
  );
}
