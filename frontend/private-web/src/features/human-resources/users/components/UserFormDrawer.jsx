import { useEffect, useState } from 'react';
import Drawer from '../../../../components/Drawer';
import RoleTypeSelector from './RoleTypeSelector';
import FormField, { inputClassName } from './FormField';
import BackOfficeFields from './BackOfficeFields';
import RampAgentFields from './RampAgentFields';
import AirlineClientFields from './AirlineClientFields';
import RoleAccessSection from './RoleAccessSection';
import AccessCredentialsSection from './AccessCredentialsSection';
import { BACK_OFFICE_USER_TYPES, PORTAL_META } from '../statusMeta';

const IDENTIFICATION_TYPES = ['Cédula', 'Pasaporte', 'RNC'];

function buildInitialFormState(record) {
  if (!record) {
    return {
      userType: 'admin_occ',
      identity: { firstName: '', lastName: '', email: '', phone: '', identificationType: 'Cédula', identificationNumber: '', avatarUrl: '' },
      roleId: '',
      backOffice: { department: '', position: '', accessLevel: '' },
      rampAgent: { employeeNumber: '', terminals: [], category: '', hireDate: '', supervisorName: '' },
      airlineClient: { airlineId: '', contactPosition: '' },
    };
  }

  return {
    userType: record.userType,
    identity: { ...record.identity },
    roleId: record.access.roleId,
    backOffice: record.backOffice ?? { department: '', position: '', accessLevel: '' },
    rampAgent: record.rampAgent ?? { employeeNumber: '', terminals: [], category: '', hireDate: '', supervisorName: '' },
    airlineClient: record.airlineClient ?? { airlineId: '', contactPosition: '' },
  };
}

function isFormValid(formState) {
  const { identity, roleId, userType, backOffice, rampAgent, airlineClient } = formState;
  if (!identity.firstName.trim() || !identity.lastName.trim() || !identity.email.trim() || !roleId) return false;
  if (BACK_OFFICE_USER_TYPES.includes(userType)) return Boolean(backOffice.department.trim() && backOffice.position.trim());
  if (userType === 'ramp_agent') {
    return Boolean(rampAgent.terminals.length && rampAgent.employeeNumber.trim() && rampAgent.category.trim() && rampAgent.hireDate);
  }
  if (userType === 'airline_client') return Boolean(airlineClient.airlineId && airlineClient.contactPosition.trim());
  return true;
}

// Drawer de creación/edición. El tipo de usuario (paso 1) determina qué
// secciones condicionales se muestran (skill.md §6-§10). Nunca incluye un
// campo de contraseña — ver AccessCredentialsSection.
export default function UserFormDrawer({ open, onClose, mode, record, roles, airlines, onSubmit }) {
  const [formState, setFormState] = useState(() => buildInitialFormState(record));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (open) {
      setFormState(buildInitialFormState(record));
      setSubmitError(null);
    }
  }, [open, record]);

  const selectedRole = roles.find(role => role.id === formState.roleId);
  const portalLabel = selectedRole ? PORTAL_META[selectedRole.portal]?.label : undefined;
  const valid = isFormValid(formState);

  function handleUserTypeChange(userType) {
    setFormState(current => ({ ...current, userType, roleId: '' }));
  }

  function updateIdentity(patch) {
    setFormState(current => ({ ...current, identity: { ...current.identity, ...patch } }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting || !valid) return;

    setSubmitting(true);
    setSubmitError(null);

    const basePayload = {
      userType: formState.userType,
      identity: { ...formState.identity },
      access: { roleId: formState.roleId },
      ...(BACK_OFFICE_USER_TYPES.includes(formState.userType) ? { backOffice: formState.backOffice } : {}),
      ...(formState.userType === 'ramp_agent' ? { rampAgent: formState.rampAgent } : {}),
      ...(formState.userType === 'airline_client' ? { airlineClient: formState.airlineClient } : {}),
    };
    const payload = mode === 'create' ? { ...basePayload, sendInvitation: true } : basePayload;

    try {
      await onSubmit(payload);
      onClose();
    } catch (error) {
      setSubmitError(error?.message ?? 'No fue posible guardar el usuario. Intente de nuevo.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={mode === 'create' ? 'Crear usuario' : 'Editar usuario'}
      description={
        mode === 'create' ? 'Paso 1: seleccione el tipo de usuario para adaptar el formulario.' : formState.identity.email
      }
      widthClassName="lg:w-[560px]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="user-form"
            disabled={submitting || !valid}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Guardando…' : mode === 'create' ? 'Crear usuario' : 'Guardar cambios'}
          </button>
        </div>
      }
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Tipo de usuario / rol
          </h3>
          <RoleTypeSelector value={formState.userType} onChange={handleUserTypeChange} disabled={mode === 'edit'} />
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Datos generales
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Nombre" required>
              <input className={inputClassName} value={formState.identity.firstName} onChange={event => updateIdentity({ firstName: event.target.value })} />
            </FormField>
            <FormField label="Apellido" required>
              <input className={inputClassName} value={formState.identity.lastName} onChange={event => updateIdentity({ lastName: event.target.value })} />
            </FormField>
            <FormField label="Correo electrónico" required>
              <input type="email" className={inputClassName} value={formState.identity.email} onChange={event => updateIdentity({ email: event.target.value })} />
            </FormField>
            <FormField label="Teléfono">
              <input className={inputClassName} value={formState.identity.phone} onChange={event => updateIdentity({ phone: event.target.value })} />
            </FormField>
            <FormField label="Tipo de identificación">
              <select className={inputClassName} value={formState.identity.identificationType} onChange={event => updateIdentity({ identificationType: event.target.value })}>
                {IDENTIFICATION_TYPES.map(type => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Número de identificación">
              <input className={inputClassName} value={formState.identity.identificationNumber} onChange={event => updateIdentity({ identificationNumber: event.target.value })} />
            </FormField>
          </div>
        </section>

        {BACK_OFFICE_USER_TYPES.includes(formState.userType) && (
          <section key={formState.userType} className="animate-fade-in space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              Back-office
            </h3>
            <BackOfficeFields value={formState.backOffice} onChange={backOffice => setFormState(current => ({ ...current, backOffice }))} />
          </section>
        )}

        {formState.userType === 'ramp_agent' && (
          <section key={formState.userType} className="animate-fade-in space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              Agente de Rampa
            </h3>
            <RampAgentFields value={formState.rampAgent} onChange={rampAgent => setFormState(current => ({ ...current, rampAgent }))} />
          </section>
        )}

        {formState.userType === 'airline_client' && (
          <section key={formState.userType} className="animate-fade-in space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              Cliente / Aerolínea
            </h3>
            <AirlineClientFields
              value={formState.airlineClient}
              onChange={airlineClient => setFormState(current => ({ ...current, airlineClient }))}
              airlines={airlines}
            />
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Roles y permisos
          </h3>
          <RoleAccessSection
            userType={formState.userType}
            roleId={formState.roleId}
            onRoleChange={roleId => setFormState(current => ({ ...current, roleId }))}
            roles={roles}
            portalLabel={portalLabel}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Acceso y credenciales
          </h3>
          <AccessCredentialsSection portalLabel={portalLabel} mode={mode} />
        </section>

        {submitError && (
          <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">
            {submitError}
          </p>
        )}
      </form>
    </Drawer>
  );
}
