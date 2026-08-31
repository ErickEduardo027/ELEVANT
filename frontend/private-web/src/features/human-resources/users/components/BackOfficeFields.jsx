import FormField, { inputClassName } from './FormField';

// Campos para Administrador/OCC, Contratos, Finanzas y Gestión Humana
// (skill.md §8).
export default function BackOfficeFields({ value, onChange }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormField label="Departamento" required>
        <input
          className={inputClassName}
          value={value.department}
          onChange={event => onChange({ ...value, department: event.target.value })}
        />
      </FormField>
      <FormField label="Cargo" required>
        <input
          className={inputClassName}
          value={value.position}
          onChange={event => onChange({ ...value, position: event.target.value })}
        />
      </FormField>
      <FormField label="Nivel de acceso (si aplica)">
        <input
          className={inputClassName}
          value={value.accessLevel ?? ''}
          onChange={event => onChange({ ...value, accessLevel: event.target.value })}
        />
      </FormField>
    </div>
  );
}
