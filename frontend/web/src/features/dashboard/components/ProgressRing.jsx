export default function ProgressRing({ pending, executed, size = 72, strokeWidth = 8 }) {
  const total = pending + executed;
  const percent = total === 0 ? 0 : Math.round((executed / total) * 100);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-black/10 dark:stroke-white/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="fill-none stroke-accent-600 transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="absolute font-mono text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
        {percent}%
      </span>
    </div>
  );
}
