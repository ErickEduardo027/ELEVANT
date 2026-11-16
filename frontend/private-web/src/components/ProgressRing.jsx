// Anillo de progreso genérico (mismo trazo SVG que el ProgressRing de
// referencia en feat/adminocc), generalizado a un porcentaje simple en lugar
// de un par pending/executed para poder reutilizarse fuera del dominio de
// servicios operativos (p. ej. cobertura de personal en Gestión Humana).
export default function ProgressRing({ percent, size = 72, strokeWidth = 8, trackClassName = '', progressClassName = 'stroke-accent-600' }) {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className={`fill-none stroke-black/10 dark:stroke-white/10 ${trackClassName}`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`fill-none transition-[stroke-dashoffset] duration-700 ease-out ${progressClassName}`}
        />
      </svg>
      <span className="absolute font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
        {clamped}%
      </span>
    </div>
  );
}
