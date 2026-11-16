import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../hooks/useToast';
import Toast from '../../../components/Toast';
import { BellIcon, IdCardIcon, UsersIcon, CalendarIcon, ShieldCheckIcon } from '../../shell/components/icons';
import NotificationsHeader from '../../notifications/components/NotificationsHeader';
import NotificationFilterBar from '../../notifications/components/NotificationFilterBar';
import NotificationFeed from '../../notifications/components/NotificationFeed';
import NotificationBulkActionsBar from '../../notifications/components/NotificationBulkActionsBar';
import NotificationDetailDrawer from '../../notifications/components/NotificationDetailDrawer';
import NotificationSettingsDrawer from '../../notifications/components/NotificationSettingsDrawer';
import NotificationEmptyState from '../../notifications/components/NotificationEmptyState';
import NotificationSkeleton from '../../notifications/components/NotificationSkeleton';
import {
  computeNotificationCounts,
  buildNotificationCategoryLabelMap,
  HUMAN_RESOURCES_NOTIFICATION_CATEGORIES,
  HUMAN_RESOURCES_NOTIFICATION_DATE_PRESETS,
} from './notificationsMappers';
import { useNotificationFilters } from './useNotificationFilters';

const CATEGORY_ICON_MAP = {
  expirations: IdCardIcon,
  accounts: UsersIcon,
  coverage: CalendarIcon,
  confirmations: ShieldCheckIcon,
  general: BellIcon,
};

const RESOURCE_ACTION_LABEL_MAP = {
  users: 'Ver usuario',
  certifications: 'Ver habilitación',
  permits: 'Ver permiso',
  schedules: 'Ver horarios',
  reports: 'Ver reporte',
};

export default function NotificationsPage({
  status,
  data,
  error,
  onRetry,
  onMarkAsRead,
  onMarkAsUnread,
  onMarkManyAsRead,
  onMarkManyAsUnread,
  onMarkAllAsRead,
  onNavigateToResource,
  preferences,
  onUpdatePreferences,
}) {
  const [selectedNotificationId, setSelectedNotificationId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [now, setNow] = useState(() => new Date().toISOString());
  const { toasts, showToast, dismissToast } = useToast();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  const notifications = data?.notifications ?? [];
  const notificationCounts = useMemo(() => computeNotificationCounts(notifications), [notifications]);
  const categoryLabelMap = useMemo(() => buildNotificationCategoryLabelMap(), []);

  const { filters, setFilter, setDatePreset, setCustomDate, resetFilters, hasActiveFilters, filteredNotifications, counts } =
    useNotificationFilters(notifications, now);

  const selectedNotification = notifications.find(notification => notification.id === selectedNotificationId) ?? null;
  const isLoading = status === 'loading';
  const isError = status === 'error';
  const thresholdDays = preferences?.expiryThresholdDays ?? 30;

  async function handleMarkAllAsRead() {
    await onMarkAllAsRead();
    showToast('Todas las notificaciones fueron marcadas como leídas.', 'success');
  }

  async function handleBulkMarkRead() {
    await onMarkManyAsRead(Array.from(selectedIds));
    setSelectedIds(new Set());
  }

  async function handleBulkMarkUnread() {
    await onMarkManyAsUnread(Array.from(selectedIds));
    setSelectedIds(new Set());
  }

  async function handleTogglePreference(categoryId, nextValue) {
    await onUpdatePreferences({ [categoryId]: nextValue });
  }

  async function handleChangeThreshold(nextValue) {
    await onUpdatePreferences({ expiryThresholdDays: nextValue });
  }

  function openNotification(id) {
    setSelectedNotificationId(id);
    const notification = notifications.find(item => item.id === id);
    if (notification && !notification.read) {
      Promise.resolve(onMarkAsRead(id))
        .then(() => showToast('Notificación marcada como leída.', 'success'))
        .catch(() => showToast('No se pudo marcar la notificación como leída.', 'danger'));
    }
  }

  function handleToggleSelect(id) {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleNavigateToResource(moduleId, resourceId) {
    setSelectedNotificationId(null);
    onNavigateToResource(moduleId, resourceId);
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] 3xl:max-w-[1760px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar las notificaciones.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const emptyVariant = notifications.length === 0 ? 'general' : hasActiveFilters ? 'filtered' : counts.unread === 0 ? 'all-read' : null;
  const filterStatusOptions = [
    { id: '', label: 'Todas' },
    { id: 'unread', label: 'Solo no leídas' },
  ];

  return (
    <div className="mx-auto max-w-[1440px] 3xl:max-w-[1760px] space-y-4">
      <NotificationsHeader counts={notificationCounts} onMarkAllAsRead={handleMarkAllAsRead} onOpenSettings={() => setSettingsOpen(true)} />

      <NotificationFilterBar
        filters={filters}
        onFilterChange={setFilter}
        onDatePreset={setDatePreset}
        onCustomDate={setCustomDate}
        onResetFilters={resetFilters}
        hasActiveFilters={hasActiveFilters}
        categoryOptions={HUMAN_RESOURCES_NOTIFICATION_CATEGORIES}
        datePresetOptions={HUMAN_RESOURCES_NOTIFICATION_DATE_PRESETS}
        statusOptions={filterStatusOptions}
        statusControlVariant="toggle"
        searchPlaceholder="Buscar por agente, documento, turno o referencia..."
      />

      <NotificationBulkActionsBar
        count={selectedIds.size}
        onMarkRead={handleBulkMarkRead}
        onMarkUnread={handleBulkMarkUnread}
        onClear={() => setSelectedIds(new Set())}
      />

      {isLoading ? (
        <NotificationSkeleton />
      ) : filteredNotifications.length === 0 ? (
        <NotificationEmptyState variant={emptyVariant ?? 'filtered'} />
      ) : (
        <NotificationFeed
          notifications={filteredNotifications}
          nowIso={now}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onOpen={openNotification}
          cardProps={{ categoryIconMap: CATEGORY_ICON_MAP }}
        />
      )}

      <NotificationDetailDrawer
        notification={selectedNotification}
        onClose={() => setSelectedNotificationId(null)}
        onMarkAsRead={onMarkAsRead}
        onMarkAsUnread={onMarkAsUnread}
        onNavigate={handleNavigateToResource}
        categoryLabelMap={categoryLabelMap}
        resourceActionLabelMap={RESOURCE_ACTION_LABEL_MAP}
      />

      <NotificationSettingsDrawer
        open={settingsOpen}
        preferences={preferences}
        onTogglePreference={handleTogglePreference}
        onChangeThreshold={handleChangeThreshold}
        thresholdDays={thresholdDays}
        thresholdOptions={[
          { id: 15, label: '15 días' },
          { id: 30, label: '30 días' },
          { id: 45, label: '45 días' },
        ]}
        onClose={() => setSettingsOpen(false)}
        categories={HUMAN_RESOURCES_NOTIFICATION_CATEGORIES}
      />

      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
