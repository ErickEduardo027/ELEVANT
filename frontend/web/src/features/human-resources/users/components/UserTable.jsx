import { useState } from 'react';
import DataTable from '../../../../components/DataTable';
import Avatar from '../../../../components/Avatar';
import EmptyState from '../../../../components/EmptyState';
import UserRoleBadge from './UserRoleBadge';
import UserStatusBadge from './UserStatusBadge';
import { UsersIcon, DotsVerticalIcon, MailIcon, KeyIcon, ChecklistIcon, CheckCircleIcon, UserMinusIcon } from '../../../shell/components/icons';

function RowActionsMenu({ item, onEdit, onActivate, onDeactivate, onResendInvitation, onResetAccess, onViewHistory, pending }) {
  const [open, setOpen] = useState(false);
  const canActivate = item.status !== 'active';
  const canDeactivate = item.status === 'active';
  const canResendInvitation = item.status === 'pending_activation' || item.status === 'invitation_sent';

  function runAndClose(action) {
    setOpen(false);
    action(item);
  }

  return (
    <div className="relative" onClick={event => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={pending}
        aria-label={`Acciones para ${item.fullName}`}
        className="rounded-lg p-1.5 text-text-secondary-light hover:bg-black/5 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark"
      >
        <DotsVerticalIcon className={`h-4 w-4 ${pending ? 'animate-pulse' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
          >
            <button type="button" role="menuitem" onClick={() => runAndClose(onEdit)} className="block w-full px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5">
              Editar
            </button>
            {canActivate && (
              <button type="button" role="menuitem" onClick={() => runAndClose(onActivate)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-status-success hover:bg-black/5 dark:hover:bg-white/5">
                <CheckCircleIcon className="h-3.5 w-3.5" /> Activar
              </button>
            )}
            {canDeactivate && (
              <button type="button" role="menuitem" onClick={() => runAndClose(onDeactivate)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-status-danger hover:bg-black/5 dark:hover:bg-white/5">
                <UserMinusIcon className="h-3.5 w-3.5" /> Desactivar
              </button>
            )}
            {canResendInvitation && (
              <button type="button" role="menuitem" onClick={() => runAndClose(onResendInvitation)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5">
                <MailIcon className="h-3.5 w-3.5" /> Reenviar invitación
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => runAndClose(onResetAccess)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5">
              <KeyIcon className="h-3.5 w-3.5" /> Restablecer acceso
            </button>
            <button type="button" role="menuitem" onClick={() => runAndClose(onViewHistory)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5">
              <ChecklistIcon className="h-3.5 w-3.5" /> Ver historial
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function UserTable({
  items,
  loading,
  hasActiveFilters,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  onEdit,
  onActivate,
  onDeactivate,
  onResendInvitation,
  onResetAccess,
  onViewHistory,
  pendingIds,
}) {
  const columns = [
    {
      key: 'user',
      label: 'Usuario',
      render: item => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={item.fullName} size="sm" imageUrl={item.avatarUrl} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-text-primary-dark">{item.fullName}</p>
            <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{item.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'identification',
      label: 'Identificación',
      className: 'hidden md:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: item => item.identificationNumber,
    },
    {
      key: 'userType',
      label: 'Tipo de usuario',
      className: 'hidden sm:table-cell',
      render: item => item.userTypeLabel,
    },
    {
      key: 'portal',
      label: 'Portal',
      className: 'hidden lg:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: item => item.portalLabel,
    },
    {
      key: 'role',
      label: 'Rol',
      render: item => <UserRoleBadge roleName={item.roleName} />,
    },
    {
      key: 'station',
      label: 'Estación / depto. / aerolínea',
      className: 'hidden xl:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: item => item.stationOrDepartmentLabel ?? '—',
    },
    {
      key: 'status',
      label: 'Estado',
      render: item => <UserStatusBadge status={item.status} />,
    },
    {
      key: 'createdAt',
      label: 'Fecha de creación',
      className: 'hidden xl:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: item => item.createdAtLabel,
    },
    {
      key: 'lastLogin',
      label: 'Último acceso',
      className: 'hidden lg:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: item => item.lastLoginLabel,
    },
    {
      key: 'actions',
      label: 'Acciones',
      className: 'text-right',
      render: item => (
        <div className="flex justify-end">
          <RowActionsMenu
            item={item}
            onEdit={onEdit}
            onActivate={onActivate}
            onDeactivate={onDeactivate}
            onResendInvitation={onResendInvitation}
            onResetAccess={onResetAccess}
            onViewHistory={onViewHistory}
            pending={pendingIds?.has(item.id) ?? false}
          />
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      getRowId={item => item.id}
      loading={loading}
      selectable
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      onToggleSelectAll={onToggleSelectAll}
      onRowClick={onRowClick}
      emptyState={
        <EmptyState
          icon={UsersIcon}
          title={hasActiveFilters ? 'No hay usuarios que coincidan con los filtros.' : 'No hay usuarios registrados.'}
          description={hasActiveFilters ? 'Ajusta o limpia los filtros para ver más resultados.' : 'Crea el primer usuario para comenzar.'}
        />
      }
    />
  );
}
