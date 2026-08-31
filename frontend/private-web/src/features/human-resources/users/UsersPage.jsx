import { useState } from 'react';
import { useUsersData } from './useUsersData';
import { useUserFilters } from './useUserFilters';
import { useDisclosure } from '../../../hooks/useDisclosure';
import { useToast } from '../../../hooks/useToast';
import Toast from '../../../components/Toast';
import Modal from '../../../components/Modal';
import { PlusIcon, RefreshCwIcon } from '../../shell/components/icons';
import UserStatsRow from './components/UserStatsRow';
import UserFilterBar from './components/UserFilterBar';
import UserTable from './components/UserTable';
import UserFormDrawer from './components/UserFormDrawer';
import UserDetailPanel from './components/UserDetailPanel';
import DeactivateConfirmModal from './components/DeactivateConfirmModal';
import BulkActionsBar from './components/BulkActionsBar';

// Composición del módulo "Gestión de usuarios y cuentas". La Topbar y el
// Sidebar de Gestión Humana ya existen (AppShell); este componente solo
// aporta el contenido del área principal, igual que DashboardPage. Toda la
// lectura/escritura de datos pasa por useUsersData (que a su vez delega en
// humanResourcesUsersService) — este archivo no importa el servicio
// directamente.
export default function UsersPage() {
  const {
    status,
    items,
    roles,
    airlines,
    error,
    kpis,
    refresh,
    createUserRecord,
    updateUserRecord,
    activateAccount,
    deactivateAccount,
    resendInvitation,
    resetAccess,
    bulkActivateAccounts,
    bulkDeactivateAccounts,
    fetchUserHistory,
  } = useUsersData();

  const { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredItems, availableOptions } = useUserFilters(items);
  const { toasts, showToast, dismissToast } = useToast();

  const formDrawer = useDisclosure();
  const detailDrawer = useDisclosure();
  const deactivateModal = useDisclosure();
  const bulkModal = useDisclosure();

  const [formMode, setFormMode] = useState('create');
  const [activeUser, setActiveUser] = useState(null);
  const [detailHistory, setDetailHistory] = useState([]);
  const [detailHistoryLoading, setDetailHistoryLoading] = useState(false);
  const [bulkAction, setBulkAction] = useState(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [deactivateSubmitting, setDeactivateSubmitting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [pendingIds, setPendingIds] = useState(() => new Set());

  const isLoading = status === 'loading';
  const isError = status === 'error';

  function markPending(userId, isPending) {
    setPendingIds(current => {
      const next = new Set(current);
      if (isPending) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  // Evita doble envío: ignora una acción si ya hay una en curso para el
  // mismo usuario (activar/reenviar invitación/restablecer acceso). El
  // estado se refleja en la UI (botones deshabilitados) vía pendingIds.
  async function runGuardedAction(userId, action, successMessage) {
    if (pendingIds.has(userId)) return;
    markPending(userId, true);
    try {
      await action();
      if (successMessage) showToast(successMessage, 'success');
    } catch (actionError) {
      showToast(actionError?.message ?? 'No fue posible completar la acción.', 'danger');
    } finally {
      markPending(userId, false);
    }
  }

  function toggleSelect(id) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids) {
    setSelectedIds(current => {
      const allSelected = ids.length > 0 && ids.every(id => current.has(id));
      const next = new Set(current);
      ids.forEach(id => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function openCreate() {
    setFormMode('create');
    setActiveUser(null);
    formDrawer.open();
  }

  function openEdit(item) {
    setFormMode('edit');
    setActiveUser(item);
    detailDrawer.close();
    formDrawer.open();
  }

  async function openDetail(item) {
    setActiveUser(item);
    detailDrawer.open();
    setDetailHistoryLoading(true);
    try {
      const history = await fetchUserHistory(item.id);
      setDetailHistory(history);
    } catch {
      setDetailHistory([]);
    } finally {
      setDetailHistoryLoading(false);
    }
  }

  async function handleFormSubmit(payload) {
    if (formMode === 'create') {
      await createUserRecord(payload);
      showToast('Usuario creado. Se envió la invitación por correo.', 'success');
    } else {
      await updateUserRecord(activeUser.id, payload);
      showToast('Cambios guardados correctamente.', 'success');
    }
  }

  function requestDeactivate(item) {
    setActiveUser(item);
    deactivateModal.open();
  }

  async function confirmDeactivate() {
    setDeactivateSubmitting(true);
    try {
      await deactivateAccount(activeUser.id);
      showToast('Cuenta desactivada.', 'success');
      deactivateModal.close();
      detailDrawer.close();
    } catch (deactivateError) {
      showToast(deactivateError?.message ?? 'No fue posible desactivar la cuenta.', 'danger');
    } finally {
      setDeactivateSubmitting(false);
    }
  }

  function handleActivate(item) {
    return runGuardedAction(item.id, () => activateAccount(item.id), 'Cuenta activada correctamente.');
  }

  function handleResendInvitation(item) {
    return runGuardedAction(item.id, () => resendInvitation(item.id), 'Invitación reenviada.');
  }

  function handleResetAccess(item) {
    return runGuardedAction(item.id, () => resetAccess(item.id), 'Acceso restablecido.');
  }

  function requestBulk(action) {
    setBulkAction(action);
    bulkModal.open();
  }

  async function confirmBulk() {
    setBulkSubmitting(true);
    try {
      const ids = Array.from(selectedIds);
      if (bulkAction === 'activate') {
        await bulkActivateAccounts(ids);
        showToast(`${ids.length} cuenta(s) activada(s).`, 'success');
      } else {
        await bulkDeactivateAccounts(ids);
        showToast(`${ids.length} cuenta(s) desactivada(s).`, 'success');
      }
      clearSelection();
      bulkModal.close();
    } catch (bulkError) {
      showToast(bulkError?.message ?? 'No fue posible completar la acción masiva.', 'danger');
    } finally {
      setBulkSubmitting(false);
    }
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar los usuarios.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={refresh}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Gestión de usuarios y cuentas</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Administra las cuentas, roles y accesos de los usuarios de ELEVANT.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            aria-label="Actualizar"
            className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" /> Actualizar
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-600/90"
          >
            <PlusIcon className="h-4 w-4" /> Crear usuario
          </button>
        </div>
      </div>

      <UserStatsRow kpis={kpis} loading={isLoading} />

      <UserFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        onResetFilters={onResetFilters}
        hasActiveFilters={hasActiveFilters}
        availableOptions={availableOptions}
      />

      <BulkActionsBar
        count={selectedIds.size}
        onActivateSelected={() => requestBulk('activate')}
        onDeactivateSelected={() => requestBulk('deactivate')}
        onClearSelection={clearSelection}
      />

      <UserTable
        items={filteredItems}
        loading={isLoading}
        hasActiveFilters={hasActiveFilters}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onRowClick={openDetail}
        onEdit={openEdit}
        onActivate={handleActivate}
        onDeactivate={requestDeactivate}
        onResendInvitation={handleResendInvitation}
        onResetAccess={handleResetAccess}
        onViewHistory={openDetail}
        pendingIds={pendingIds}
      />

      <UserFormDrawer
        open={formDrawer.isOpen}
        onClose={formDrawer.close}
        mode={formMode}
        record={formMode === 'edit' ? activeUser?.record : null}
        roles={roles}
        airlines={airlines}
        onSubmit={handleFormSubmit}
      />

      <UserDetailPanel
        open={detailDrawer.isOpen}
        onClose={detailDrawer.close}
        item={activeUser}
        history={detailHistory}
        historyLoading={detailHistoryLoading}
        onEdit={openEdit}
        onActivate={handleActivate}
        onDeactivate={requestDeactivate}
        onResendInvitation={handleResendInvitation}
        onResetAccess={handleResetAccess}
        pending={activeUser ? pendingIds.has(activeUser.id) : false}
      />

      <DeactivateConfirmModal
        open={deactivateModal.isOpen}
        onClose={deactivateModal.close}
        user={activeUser}
        submitting={deactivateSubmitting}
        onConfirm={confirmDeactivate}
      />

      <Modal
        open={bulkModal.isOpen}
        onClose={bulkSubmitting ? () => {} : bulkModal.close}
        title={bulkAction === 'activate' ? '¿Activar las cuentas seleccionadas?' : '¿Desactivar las cuentas seleccionadas?'}
        tone={bulkAction === 'deactivate' ? 'danger' : 'default'}
        footer={
          <>
            <button
              type="button"
              onClick={bulkModal.close}
              disabled={bulkSubmitting}
              className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmBulk}
              disabled={bulkSubmitting}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                bulkAction === 'deactivate' ? 'bg-status-danger hover:bg-status-danger/90' : 'bg-accent-600 hover:bg-accent-600/90'
              }`}
            >
              {bulkSubmitting ? 'Procesando…' : bulkAction === 'activate' ? 'Activar seleccionados' : 'Desactivar seleccionados'}
            </button>
          </>
        }
      >
        <p>
          Esta acción se aplicará a {selectedIds.size} cuenta{selectedIds.size === 1 ? '' : 's'} seleccionada
          {selectedIds.size === 1 ? '' : 's'}.
        </p>
      </Modal>

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
