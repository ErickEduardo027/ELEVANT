const SIZE = 160;
const STROKE = 20;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Gráfico de dona genérico por categorías (mismo trazo SVG que
// FlightStatusChart en feat/adminocc), generalizado para recibir
// segmentos ya resueltos ({ key, label, value, color }) en vez de un
// dominio de estados de vuelo. No depende de ninguna librería de
// gráficos: se mantiene la misma técnica (arcos SVG con stroke-dasharray).
export default function CategoryDonutChart({ title, segments }) {
  const total = segments.reduce((sum, entry) => sum + entry.value, 0);
  let cumulative = 0;

  return (
    <div>
      {title && (
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
          {title}
        </h3>
      )}
      <div className="flex flex-wrap items-center gap-6">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} className="-rotate-90">
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              strokeWidth={STROKE}
              className="fill-none stroke-black/5 dark:stroke-white/5"
            />
            {segments.map(entry => {
              const fraction = total === 0 ? 0 : entry.value / total;
              const dash = fraction * CIRCUMFERENCE;
              const dashArray = `${dash} ${CIRCUMFERENCE - dash}`;
              const dashOffset = -cumulative;
              cumulative += dash;
              return (
                <circle
                  key={entry.key}
                  data-testid="donut-segment"
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  strokeWidth={STROKE}
                  strokeDasharray={dashArray}
                  strokeDashoffset={dashOffset}
                  className="fill-none"
                  stroke={entry.color}
                />
              );
            })}
          </svg>
          <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-semibold text-ink-900 dark:text-text-primary-dark">
            {total}
          </span>
        </div>

        <ul className="min-w-40 flex-1 space-y-1.5">
          {segments.map(entry => (
            <li key={entry.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-ink-900 dark:text-text-primary-dark">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                {entry.label}
              </span>
              <span className="font-mono text-text-secondary-light dark:text-text-secondary-dark">{entry.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
