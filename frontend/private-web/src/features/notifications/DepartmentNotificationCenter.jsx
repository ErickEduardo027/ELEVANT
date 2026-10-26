import { useCallback, useState } from 'react';
import Drawer from '../../components/Drawer';
import Toast from '../../components/Toast';
import { useToast } from '../../hooks/useToast';
import { describeNotification } from './departmentNotifications';
import useDepartmentNotifications from './useDepartmentNotifications';

const dateFormat = new Intl.DateTimeFormat('es-DO', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Bell feed of a department shell: alerts pop up on screen as they arrive (a toast with
 * «Abrir» that never takes focus, so typing in a form is not interrupted) and the drawer
 * lists the latest ones. `onOpen` receives the alert's target menu option.
 */
export function useDepartmentNotificationCenter({ enabled = true, onOpen }) {
  const [open, setOpen] = useState(false);
  const { toasts, showToast, dismissToast } = useToast();
  const notifications = useDepartmentNotifications({
    enabled,
    onArrive: useCallback(fresh => {
      fresh.slice(0, 3).forEach(item => {
        const { message, target } = describeNotification(item);
        showToast(message, 'info', 8000, target ? { label: 'Abrir', onClick: () => {
          void notifications.markRead(item.id).catch(() => {});
          onOpen?.(target);
        } } : null);
      });
      if (fresh.length > 3) showToast(`Tienes ${fresh.length - 3} notificaciones nuevas más.`, 'info', 8000,
        { label: 'Ver', onClick: () => setOpen(true) });
    // `notifications` is read when the toast is clicked, after this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onOpen, showToast]),
  });

  const ui = enabled ? (
    <>
      <Toast toasts={toasts} onDismiss={dismissToast} />
      <Drawer open={open} onClose={() => setOpen(false)} title="Notificaciones"
        description="Avisos de tu departamento. Se actualizan solos cuando llega algo nuevo."
        footer={notifications.unreadCount > 0 && (
          <button type="button" onClick={() => void notifications.markAllRead().catch(() => {})}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold dark:border-white/10">
            Marcar todas como leídas
          </button>
        )}>
        <NotificationList state={notifications} onOpen={target => { setOpen(false); onOpen?.(target); }} />
      </Drawer>
    </>
  ) : null;

  return { count: notifications.unreadCount, openPanel: () => setOpen(true), ui, notifications };
}

export function NotificationList({ state, onOpen }) {
  if (state.status === 'loading') return <p className="text-sm text-text-secondary-light">Cargando notificaciones…</p>;
  if (state.status === 'unauthorized')
    return <p role="alert" className="text-sm">Tu acceso no incluye la opción «Notificaciones». Pide al administrador del departamento que la conceda.</p>;
  if (state.status === 'error')
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>No fue posible cargar las notificaciones.</p>
        <button type="button" onClick={() => void state.refresh()} className="font-semibold text-accent-600 underline">Reintentar</button>
      </div>
    );
  if (!state.items.length) return <p className="text-sm text-text-secondary-light">No tienes notificaciones por ahora.</p>;
  return (
    <ul className="space-y-2">
      {state.items.map(item => {
        const { title, subject, target } = describeNotification(item);
        return (
          <li key={item.id} className={`rounded-lg border p-3 ${item.readAt ? 'border-black/5 dark:border-white/5' : 'border-accent-600/40 bg-accent-600/5'}`}>
            <p className="text-sm font-semibold">{!item.readAt && <span className="sr-only">Sin leer: </span>}{title}</p>
            {subject && <p className="text-sm">{subject}</p>}
            <p className="text-xs text-text-secondary-light">{dateFormat.format(new Date(item.occurredAt))}</p>
            <div className="mt-2 flex gap-3 text-xs font-semibold">
              {target && <button type="button" className="text-accent-600 underline"
                onClick={() => { if (!item.readAt) void state.markRead(item.id).catch(() => {}); onOpen(target); }}>Abrir</button>}
              <button type="button" className="underline" onClick={() => void state.markRead(item.id, !item.readAt).catch(() => {})}>
                {item.readAt ? 'Marcar como no leída' : 'Marcar como leída'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
