// Barras horizontales genéricas para distribuciones simples (p. ej.
// personal por turno). No existe un precedente directo en feat/adminocc
// para este patrón; se construye siguiendo el mismo lenguaje visual
// (radios, tokens de color, tooltips con valor exacto vía title nativo).
export default function HorizontalBarList({ items, barClassName = 'bg-accent-600', max: maxOverride }) {
  const max = maxOverride ?? Math.max(1, ...items.map(item => item.value));

  return (
    <ul className="space-y-2.5">
      {items.map(item => (
        <li key={item.key} title={`${item.label}: ${item.displayValue ?? item.value}`}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-ink-900 dark:text-text-primary-dark">{item.label}</span>
            <span className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {item.displayValue ?? item.value}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-out ${item.className ?? barClassName}`}
              style={{ width: `${Math.round((item.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
