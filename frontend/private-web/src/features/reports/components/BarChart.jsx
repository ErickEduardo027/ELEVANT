const BAR_COLOR = '#145DC4';

function VerticalBars({ data, max }) {
  return (
    <div className="flex items-end gap-2">
      {data.map(entry => (
        <div key={entry.label} className="flex flex-1 flex-col items-center gap-1.5" title={`${entry.label}: ${entry.value}`}>
          <span className="font-mono text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{entry.value}</span>
          <div className="flex h-28 w-full items-end rounded-t-md bg-black/5 dark:bg-white/5">
            <div
              data-testid="bar-chart-bar"
              className="w-full rounded-t-md"
              style={{ height: `${max === 0 ? 0 : (entry.value / max) * 100}%`, backgroundColor: BAR_COLOR }}
            />
          </div>
          <span className="max-w-full truncate text-[11px] text-text-secondary-light dark:text-text-secondary-dark">
            {entry.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function HorizontalBars({ data, max }) {
  return (
    <ul className="space-y-2">
      {data.map(entry => (
        <li key={entry.label} title={`${entry.label}: ${entry.value}`} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-xs text-ink-900 dark:text-text-primary-dark">{entry.label}</span>
          <div className="h-2.5 flex-1 rounded-full bg-black/5 dark:bg-white/5">
            <div
              data-testid="bar-chart-bar"
              className="h-2.5 rounded-full"
              style={{ width: `${max === 0 ? 0 : (entry.value / max) * 100}%`, backgroundColor: BAR_COLOR }}
            />
          </div>
          <span className="w-8 shrink-0 text-right font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {entry.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function BarChart({ title, data, orientation = 'vertical' }) {
  const max = Math.max(1, ...data.map(entry => entry.value));

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-4 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Sin datos para el período seleccionado.</p>
      ) : orientation === 'horizontal' ? (
        <HorizontalBars data={data} max={max} />
      ) : (
        <VerticalBars data={data} max={max} />
      )}
    </div>
  );
}
