import { useEffect, useState } from 'react';
import { useReviewSelection } from '../review/useReviewSelection';
import { useReviewToasts } from '../review/useReviewToasts';
import ReviewToastStack from '../review/components/ReviewToast';
import NotificationsHeader from './components/NotificationsHeader';
import NotificationFilterBar from './components/NotificationFilterBar';
import NotificationFeed from './components/NotificationFeed';
import NotificationBulkActionsBar from './components/NotificationBulkActionsBar';
import NotificationDetailDrawer from './components/NotificationDetailDrawer';
import NotificationSettingsDrawer from './components/NotificationSettingsDrawer';
import NotificationEmptyState from './components/NotificationEmptyState';
import NotificationSkeleton from './components/NotificationSkeleton';
import { useNotificationFilters } from './useNotificationFilters';
import { getNotificationPreferences, updateNotificationPreferences } from '../../services/notificationsService';

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
  forceState = 'default',
}) {
  const [selectedNotificationId, setSelectedNotificationId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getNotificationPreferences().then(setPreferences);
  }, []);

  const selection = useReviewSelection();
  const { toasts, pushToast, dismissToast } = useReviewToasts();

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'notificationsError';
  const notifications = forceState === 'notificationsEmpty' ? [] : data?.notifications ?? [];

  const { filters, setFilter, setDatePreset, setCustomDate, resetFilters, hasActiveFilters, filteredNotifications, counts } =
    useNotificationFilters(notifications, now);

  const selectedNotification = notifications.find(n => n.id === selectedNotificationId) ?? null;

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No se pudo cargar las notificaciones.</p>
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

  function openNotification(id) {
    setSelectedNotificationId(id);
    const notification = notifications.find(n => n.id === id);
    if (notification && !notification.read) {
      Promise.resolve(onMarkAsRead(id))
        .then(() => pushToast('Notificación marcada como leída.', 'success'))
        .catch(() => pushToast('No se pudo marcar la notificación como leída.', 'error'));
    }
  }

  async function handleMarkAllAsRead() {
    await onMarkAllAsRead();
    pushToast('Todas las notificaciones fueron marcadas como leídas.', 'success');
  }

  async function handleBulkMarkRead() {
    await onMarkManyAsRead(selection.selectedIdList);
    selection.clear();
  }

  async function handleBulkMarkUnread() {
    await onMarkManyAsUnread(selection.selectedIdList);
    selection.clear();
  }

  async function handleTogglePreference(categoryId, nextValue) {
    const updated = await updateNotificationPreferences({ [categoryId]: nextValue });
    setPreferences(updated);
  }

  function handleNavigate(relatedModule, relatedRoute) {
    setSelectedNotificationId(null);
    onNavigateToResource(relatedModule, relatedRoute);
  }

  const emptyVariant = notifications.length === 0 ? 'general' : hasActiveFilters ? 'filtered' : counts.unread === 0 ? 'all-read' : null;

  return (
    <div className="space-y-4">
      <NotificationsHeader counts={counts} onMarkAllAsRead={handleMarkAllAsRead} onOpenSettings={() => setSettingsOpen(true)} />

      <NotificationFilterBar
        filters={filters}
        onFilterChange={setFilter}
        onDatePreset={setDatePreset}
        onCustomDate={setCustomDate}
        onResetFilters={resetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      <NotificationBulkActionsBar
        count={selection.selectedCount}
        onMarkRead={handleBulkMarkRead}
        onMarkUnread={handleBulkMarkUnread}
        onClear={selection.clear}
      />

      {isLoading ? (
        <NotificationSkeleton />
      ) : filteredNotifications.length === 0 ? (
        <NotificationEmptyState variant={emptyVariant ?? 'filtered'} />
      ) : (
        <NotificationFeed
          notifications={filteredNotifications}
          nowIso={now}
          selectedIds={selection.selectedIds}
          onToggleSelect={selection.toggle}
          onOpen={openNotification}
        />
      )}

      <NotificationDetailDrawer
        notification={selectedNotification}
        onClose={() => setSelectedNotificationId(null)}
        onMarkAsRead={onMarkAsRead}
        onMarkAsUnread={onMarkAsUnread}
        onNavigate={handleNavigate}
      />

      <NotificationSettingsDrawer
        open={settingsOpen}
        preferences={preferences}
        onTogglePreference={handleTogglePreference}
        onClose={() => setSettingsOpen(false)}
      />

      <ReviewToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
