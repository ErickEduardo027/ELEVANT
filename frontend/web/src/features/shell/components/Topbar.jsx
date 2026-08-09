import { useState } from 'react';
import { formatClockTime, formatUtcClockTime } from '../../../lib/clock';
import { BellIcon, ChevronDownIcon, MenuIcon, MoonIcon, SunIcon } from './icons';

export default function Topbar({ roleLabel, station, notificationsCount = 0, theme, onToggleTheme, user, onOpenMenu, onOpenNotifications }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="flex items-center gap-4 border-b border-black/5 bg-white/70 px-6 py-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      {onOpenMenu && (
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menú de navegación"
          className="-ml-1 rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5 sm:hidden"
        >
          <MenuIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
      )}

      {station ? (
        <>
          <button
            type="button"
            className="flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark"
          >
            {station.code}
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-3 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
            <span>
              {station.localAbbr} {formatClockTime(station.localTime)}
            </span>
            <span aria-hidden="true">·</span>
            <span>UTC {formatUtcClockTime(station.utcTime)}</span>
          </div>
        </>
      ) : (
        roleLabel && (
          <span className="rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark">
            {roleLabel}
          </span>
        )
      )}

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenNotifications}
          aria-label="Notificaciones"
          className="relative rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/5"
        >
          <BellIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
          {notificationsCount > 0 && (
            <span
              data-testid="notifications-badge"
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-500 px-1 text-[10px] font-semibold text-white"
            >
              {notificationsCount > 99 ? '99+' : notificationsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
          className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/5"
        >
          {theme === 'light' ? (
            <MoonIcon className="h-4 w-4 text-ink-900" />
          ) : (
            <SunIcon className="h-4 w-4 text-text-primary-dark" />
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen(open => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-black/5 dark:hover:bg-white/5"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
              {user.name
                .split(' ')
                .map(part => part[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span className="text-xs font-medium text-ink-900 dark:text-text-primary-dark">{user.name}</span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-2 w-44 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
            >
              <div className="px-3 py-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {user.role}
              </div>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
              >
                Perfil
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-sm text-status-danger hover:bg-black/5 dark:hover:bg-white/5"
              >
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
