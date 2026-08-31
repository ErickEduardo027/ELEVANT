const TONE_CLASSES = {
  default: 'bg-black/5 text-ink-900 dark:bg-white/10 dark:text-text-primary-dark',
  accent: 'bg-accent-600/10 text-accent-600',
  info: 'bg-status-info/10 text-status-info',
  active: 'bg-status-active/10 text-status-active',
  success: 'bg-status-success/10 text-status-success',
  warning: 'bg-status-warning/10 text-status-warning',
  danger: 'bg-status-danger/10 text-status-danger',
  neutral: 'bg-status-neutral/10 text-status-neutral',
};

// Chip de relleno para taxonomías (rol, portal, tipo de usuario), distinto de
// `StatusBadge` (punto + etiqueta, reservado para estado de cuenta/vuelo).
// Presentacional puro: cada dominio resuelve su propio tono, igual que
// `StatusBadge`.
export default function Badge({ tone = 'default', label, icon: IconComponent }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        TONE_CLASSES[tone] ?? TONE_CLASSES.default
      }`}
    >
      {IconComponent && <IconComponent className="h-3 w-3" />}
      {label}
    </span>
  );
}
