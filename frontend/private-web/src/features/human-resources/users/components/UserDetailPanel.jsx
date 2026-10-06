import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Drawer from '../../../../components/Drawer';
import Tabs from '../../../../components/Tabs';
import Badge from '../../../../components/Badge';
import Avatar from '../../../../components/Avatar';
import DetailSection, { DetailRow } from './DetailSection';
import UserRoleBadge from './UserRoleBadge';
import UserStatusBadge from './UserStatusBadge';
import AccountAuditTimeline from './AccountAuditTimeline';
import { ShieldCheckIcon } from '../../../shell/components/icons';

const BASE_TABS = [
  { id: 'general', label: 'Información general' },
  { id: 'roles', label: 'Roles y permisos' },
  { id: 'access', label: 'Acceso' },
  { id: 'activity', label: 'Actividad' },
];

// Detalle en drawer con pestañas (skill.md §13). "Habilitaciones" solo se
// muestra para Agente de Rampa y enlaza al futuro módulo dedicado — no
// implementa las habilitaciones completas aquí.
export default function UserDetailPanel({
  open,
  onClose,
  item,
  history,
  historyLoading,
  onEdit,
  onActivate,
  onDeactivate,
  onResendInvitation,
  onResetAccess,
  pending,
}) {
  const [activeTab, setActiveTab] = useState('general');
  const router = useRouter();

  if (!item) {
    return <Drawer open={open} onClose={onClose} title="" widthClassName="lg:w-[60%]" />;
  }

  const tabs = item.userType === 'ramp_agent' ? [...BASE_TABS, { id: 'certifications', label: 'Habilitaciones' }] : BASE_TABS;
  const record = item.record;
  const canActivate = item.status !== 'active';
  const canDeactivate = item.status === 'active';
  const canResendInvitation = item.status === 'pending_activation' || item.status === 'invitation_sent';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={item.fullName}
      description={item.email}
      widthClassName="lg:w-[60%]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canActivate && (
            <button
              type="button"
              onClick={() => onActivate(item)}
              disabled={pending}
              className="rounded-lg border border-status-success/40 px-3 py-1.5 text-xs font-semibold text-status-success hover:bg-status-success/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              Activar
            </button>
          )}
          {canDeactivate && (
            <button
              type="button"
              onClick={() => onDeactivate(item)}
              className="rounded-lg border border-status-danger/40 px-3 py-1.5 text-xs font-semibold text-status-danger hover:bg-status-danger/10"
            >
              Desactivar
            </button>
          )}
          {canResendInvitation && (
            <button
              type="button"
              onClick={() => onResendInvitation(item)}
              disabled={pending}
              className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
            >
              Reenviar invitación
            </button>
          )}
          <button
            type="button"
            onClick={() => onResetAccess(item)}
            disabled={pending}
            className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Restablecer acceso
          </button>
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
          >
            Editar
          </button>
        </div>
      }
    >
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={item.fullName} size="lg" imageUrl={item.avatarUrl} />
        <div>
          <div className="flex items-center gap-2">
            <UserStatusBadge status={item.status} />
            <UserRoleBadge roleName={item.roleName} />
          </div>
          <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {item.userTypeLabel} · {item.portalLabel}
          </p>
        </div>
      </div>

      <Tabs tabs={tabs} activeId={activeTab} onChange={setActiveTab} />

      <div className="mt-4 space-y-5">
        {activeTab === 'general' && (
          <DetailSection title="Información general">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailRow label="Nombre completo" value={item.fullName} />
              <DetailRow label="Correo" value={item.email} />
              <DetailRow label="Teléfono" value={record.identity.phone || '—'} />
              <DetailRow label="Identificación" value={`${record.identity.identificationType} · ${record.identity.identificationNumber}`} />
              {record.backOffice && <DetailRow label="Departamento" value={record.backOffice.department} />}
              {record.backOffice && <DetailRow label="Cargo" value={record.backOffice.position} />}
              {record.rampAgent && <DetailRow label="Número de empleado" value={record.rampAgent.employeeNumber} />}
              {record.rampAgent && <DetailRow label="Terminal" value={record.rampAgent.terminals.join(' / ')} />}
              {record.rampAgent && <DetailRow label="Supervisor" value={record.rampAgent.supervisorName || '—'} />}
              {record.airlineClient && <DetailRow label="Aerolínea" value={item.stationOrDepartmentLabel ?? '—'} />}
              {record.airlineClient && <DetailRow label="Cargo en la aerolínea" value={record.airlineClient.contactPosition} />}
            </div>
          </DetailSection>
        )}

        {activeTab === 'roles' && (
          <DetailSection title="Roles y permisos">
            <div className="space-y-3">
              <DetailRow label="Rol actual" value={item.roleName} />
              <DetailRow label="Portal" value={item.portalLabel} />
              <div>
                <p className="mb-1.5 text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">
                  Permisos heredados del rol
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {record.access.permissions.map(permission => (
                    <Badge key={permission} tone="default" label={permission} />
                  ))}
                </div>
              </div>
              <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Los cambios de rol quedan registrados en la pestaña Actividad.
              </p>
            </div>
          </DetailSection>
        )}

        {activeTab === 'access' && (
          <DetailSection title="Acceso">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DetailRow label="Estado" value={item.statusLabel} />
              <DetailRow label="Fecha de creación" value={item.createdAtLabel} />
              <DetailRow label="Último acceso" value={item.lastLoginLabel} />
              <DetailRow label="Estado de invitación" value={record.account.invitationStatus} />
            </div>
          </DetailSection>
        )}

        {activeTab === 'activity' && (
          <DetailSection title="Actividad">
            <AccountAuditTimeline events={history} loading={historyLoading} />
          </DetailSection>
        )}

        {activeTab === 'certifications' && (
          <DetailSection title="Habilitaciones">
            <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
              Resumen de habilitaciones y certificaciones de este agente.
            </p>
            <button
              type="button"
              onClick={() => router.push(`/gestion-humana/certifications?agentId=${item.id}`)}
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent-600 hover:underline"
            >
              <ShieldCheckIcon className="h-4 w-4" /> Ver habilitaciones completas
            </button>
          </DetailSection>
        )}
      </div>
    </Drawer>
  );
}
