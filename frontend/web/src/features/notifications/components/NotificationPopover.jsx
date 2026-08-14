import { useState } from 'react';

function formatDate(value) {
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export default function NotificationPopover({ center, onClose }) {
  const [actionError, setActionError] = useState('');
  const visibleItems = center.items.slice(0, 8);

  async function markAsRead(id) {
    setActionError('');
    try {
      await center.markAsRead(id);
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function markAll() {
    setActionError('');
    try {
      await center.markAllAsRead();
    } catch (error) {
      setActionError(error.message);
    }
  }

  return (
    <section
      aria-label="Centro de notificaciones"
      className="absolute right-0 top-full z-30 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-surface-dark-card"
    >
      <header className="flex items-center justify-between border-b border-black/5 px-4 py-3 dark:border-white/5">
        <div>
          <h2 className="text-sm font-semibold">Notificaciones</h2>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{center.count} pendientes de lectura</p>
        </div>
        <div className="flex items-center gap-2">
          {center.count > 0 && <button type="button" onClick={markAll} className="text-xs font-semibold text-accent-600 hover:underline">Leer todas</button>}
          <button type="button" onClick={onClose} aria-label="Cerrar notificaciones" className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-black/5 dark:hover:bg-white/5">×</button>
        </div>
      </header>

      <div className="max-h-[420px] overflow-y-auto p-2">
        {center.status === 'loading' && center.items.length === 0 ? (
          <p className="p-5 text-center text-sm text-text-secondary-light dark:text-text-secondary-dark">Cargando avisos…</p>
        ) : center.status === 'error' && center.items.length === 0 ? (
          <div className="p-5 text-center text-sm">
            <p className="text-status-danger">No se pudieron cargar las notificaciones.</p>
            <button type="button" onClick={center.refresh} className="mt-2 font-semibold text-accent-600">Reintentar</button>
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="p-5 text-center text-sm text-text-secondary-light dark:text-text-secondary-dark">No tienes notificaciones.</p>
        ) : (
          <ul className="space-y-1">
            {visibleItems.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => !item.read && markAsRead(item.id)}
                  className={`w-full rounded-xl p-3 text-left hover:bg-black/5 dark:hover:bg-white/5 ${item.read ? '' : 'bg-accent-600/5 dark:bg-accent-600/10'}`}
                >
                  <div className="flex items-start gap-2">
                    {!item.read && <span aria-label="No leída" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-text-secondary-light dark:text-text-secondary-dark">{item.description}</p>
                      <p className="mt-1 text-[11px] text-text-secondary-light dark:text-text-secondary-dark">{item.source} · {formatDate(item.createdAt)}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {actionError && <p className="px-3 py-2 text-xs text-status-danger">{actionError}</p>}
      </div>
    </section>
  );
}
