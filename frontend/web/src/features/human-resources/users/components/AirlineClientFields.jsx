import FormField, { inputClassName } from './FormField';

// Campos para Cliente / Aerolínea (skill.md §10). Correo y teléfono ya se
// capturan en "Datos generales"; aquí solo se agrega lo específico del
// vínculo con la aerolínea. El selector consume el catálogo PROVISIONAL de
// aerolíneas (ver humanResourcesUsersService.getAirlines) hasta que exista
// el catálogo real del módulo Contratos.
export default function AirlineClientFields({ value, onChange, airlines }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormField label="Aerolínea vinculada" required>
        <select
          className={inputClassName}
          value={value.airlineId}
          onChange={event => onChange({ ...value, airlineId: event.target.value })}
        >
          <option value="">Seleccionar aerolínea</option>
          {airlines.map(airline => (
            <option key={airline.id} value={airline.id}>
              {airline.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Cargo dentro de la aerolínea" required>
        <input
          className={inputClassName}
          value={value.contactPosition}
          onChange={event => onChange({ ...value, contactPosition: event.target.value })}
        />
      </FormField>
    </div>
  );
}
