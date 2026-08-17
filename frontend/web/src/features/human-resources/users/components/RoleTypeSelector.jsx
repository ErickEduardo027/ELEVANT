import { USER_TYPE_OPTIONS } from '../statusMeta';

// Paso 1 del formulario: la selección determina qué campos aparecen
// después (skill.md §6). Deshabilitado al editar — el tipo de usuario no
// cambia de portal/rol base una vez creada la cuenta.
export default function RoleTypeSelector({ value, onChange, disabled }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {USER_TYPE_OPTIONS.map(option => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
            className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
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
  );
}
