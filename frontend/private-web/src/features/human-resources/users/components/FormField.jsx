// Wrapper de campo (label + hint/error) compartido por todos los
// formularios de este módulo, para no repetir el markup en cada bloque
// condicional (Back-office / Agente de Rampa / Cliente Aerolínea).
export const inputClassName =
  'w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2 text-sm text-ink-900 focus:border-accent-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark';

export default function FormField({ label, required, hint, error, children }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1 text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">
        {label}
        {required && <span className="text-status-danger">*</span>}
      </span>
      {children}
      {hint && !error && (
        <span className="mt-1 block text-xs text-text-secondary-light dark:text-text-secondary-dark">{hint}</span>
      )}
      {error && <span className="mt-1 block text-xs text-status-danger">{error}</span>}
    </label>
  );
}
