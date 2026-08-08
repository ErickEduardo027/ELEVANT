import { NOTIFICATION_CATEGORIES } from '../notificationsMappers';
import { useEscapeToClose } from '../useEscapeToClose';
import { XIcon } from '../../review/components/icons';

function PreferenceToggle({ category, value, onTogglePreference }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-ink-900 dark:text-text-primary-dark">{category.label}</span>
      <div className="flex gap-1 rounded-lg border border-black/10 p-0.5 dark:border-white/10">
        {[
          { id: 'show', label: 'Mostrar' },
          { id: 'mute', label: 'Silenciar' },
        ].map(option => (
          <button
            key={option.id}
            type="button"
            aria-pressed={value === option.id}
            onClick={() => onTogglePreference(category.id, option.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors duration-200 ${
              value === option.id
                ? 'bg-accent-600 text-white'
                : 'text-text-secondary-light hover:text-ink-900 dark:text-text-secondary-dark dark:hover:text-text-primary-dark'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function NotificationSettingsDrawer({ open, preferences, onTogglePreference, onClose }) {
  useEscapeToClose(open, onClose);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200" onClick={onClose} />
      <aside
        data-testid="notification-settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-settings-title"
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-black/5 bg-white/95 shadow-lg backdrop-blur-md transition-transform duration-200 dark:border-white/5 dark:bg-surface-dark-card lg:w-[420px]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-black/5 px-5 py-4 dark:border-white/5">
          <div>
            <p id="notification-settings-title" className="text-base font-semibold text-ink-900 dark:text-text-primary-dark">
              Preferencias de notificaciones
            </p>
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
              Elija qué categorías desea recibir.
            </p>
          </div>
          <button
            type="button"
            aria-label="Cerrar preferencias"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 divide-y divide-black/5 overflow-y-auto px-5 dark:divide-white/5">
          {NOTIFICATION_CATEGORIES.map(category => (
            <PreferenceToggle
              key={category.id}
              category={category}
              value={preferences?.[category.id] ?? 'show'}
              onTogglePreference={onTogglePreference}
            />
          ))}
        </div>
      </aside>
    </>
  );
}
