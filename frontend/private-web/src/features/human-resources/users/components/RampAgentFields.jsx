import FormField, { inputClassName } from './FormField';

const TERMINAL_OPTIONS = [
  { value: ['A'], label: 'Terminal A' },
  { value: ['B'], label: 'Terminal B' },
  { value: ['A', 'B'], label: 'Ambas' },
];

function sameTerminals(a = [], b = []) {
  return a.length === b.length && a.every(terminal => b.includes(terminal));
}

// Campos para Agente de Rampa (skill.md §9). No implementa las
// habilitaciones/certificaciones completas — solo enlaza al futuro módulo.
export default function RampAgentFields({ value, onChange }) {
  return (
    <div className="space-y-3">
      <FormField label="Terminal" required>
        <div className="flex gap-2">
          {TERMINAL_OPTIONS.map(option => {
            const isActive = sameTerminals(value.terminals, option.value);
            return (
              <button
                key={option.label}
                type="button"
                onClick={() => onChange({ ...value, terminals: option.value })}
                aria-pressed={isActive}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-accent-600 bg-accent-600/10 text-accent-600'
                    : 'border-black/10 text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Número de empleado" required>
          <input
            className={inputClassName}
            value={value.employeeNumber}
            onChange={event => onChange({ ...value, employeeNumber: event.target.value })}
          />
        </FormField>
        <FormField label="Cargo / categoría" required>
          <input
            className={inputClassName}
            value={value.category}
            onChange={event => onChange({ ...value, category: event.target.value })}
          />
        </FormField>
        <FormField label="Fecha de ingreso" required>
          <input
            type="date"
            className={inputClassName}
            value={value.hireDate ? value.hireDate.slice(0, 10) : ''}
            onChange={event => onChange({ ...value, hireDate: event.target.value })}
          />
        </FormField>
        <FormField label="Supervisor (si aplica)">
          <input
            className={inputClassName}
            value={value.supervisorName ?? ''}
            onChange={event => onChange({ ...value, supervisorName: event.target.value })}
          />
        </FormField>
      </div>

      <p className="rounded-lg bg-accent-600/5 p-3 text-xs text-ink-900 dark:text-text-primary-dark">
        Esta cuenta habilita el acceso del agente a la aplicación móvil de operaciones.
      </p>

      <p className="rounded-lg border border-black/10 p-3 text-xs text-text-secondary-light dark:border-white/10 dark:text-text-secondary-dark">
        Las habilitaciones y certificaciones completas se administran en su propio módulo (próximamente:
        "Habilitaciones y certificaciones"). Aquí solo se registra el acceso base a la app móvil.
      </p>
    </div>
  );
}
