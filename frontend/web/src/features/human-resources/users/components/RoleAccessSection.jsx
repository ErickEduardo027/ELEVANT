import FormField, { inputClassName } from './FormField';
import Badge from '../../../../components/Badge';

// El rol seleccionado determina el portal y los permisos mostrados (RBAC):
// no se editan permisos individualmente desde este frontend (skill.md §12).
export default function RoleAccessSection({ userType, roleId, onRoleChange, roles, portalLabel }) {
  const rolesForType = roles.filter(role => role.userType === userType);
  const selectedRole = roles.find(role => role.id === roleId);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Rol" required>
          <select className={inputClassName} value={roleId} onChange={event => onRoleChange(event.target.value)}>
            <option value="">Seleccionar rol</option>
            {rolesForType.map(role => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Portal">
          <input className={inputClassName} value={portalLabel ?? '—'} disabled readOnly />
        </FormField>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">
          Permisos heredados del rol
        </p>
        <div className="flex flex-wrap gap-1.5">
          {selectedRole && selectedRole.permissions.length > 0 ? (
            selectedRole.permissions.map(permission => <Badge key={permission} tone="default" label={permission} />)
          ) : (
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Seleccione un rol para ver sus permisos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
