import { useState } from 'react';
import { formatClockTime, formatUtcClockTime } from '../../../lib/clock';
import { BellIcon, ChevronDownIcon, MenuIcon, MoonIcon, SunIcon } from './icons';
import NotificationPopover from '../../notifications/components/NotificationPopover';

function initials(name) {
  return name
    .split(' ')
    .map(part => part[0])
    .slice(0, 2)
    .join('');
}

export default function Topbar({
  station,
  notificationsCount,
  notificationsEnabled = true,
  theme,
  onToggleTheme,
  user,
  roleLabel,
  onOpenMenu,
  onOpenNotifications,
  notificationCenter,
  profileActionsEnabled = true,
  onLogout,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const localClock = station ? `${station.localAbbr} ${formatClockTime(station.localTime)}` : '';
  const utcClock = station ? `UTC ${formatUtcClockTime(station.utcTime)}` : '';

  return (
    <header className="relative z-nav flex shrink-0 items-center gap-2 border-b border-black/5 bg-white/70 px-3 py-2.5 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card sm:gap-4 sm:px-6 sm:py-3">
      {onOpenMenu && (
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Abrir menú de navegación"
          className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/5 sm:hidden"
        >
          <MenuIcon className="h-4 w-4 text-ink-900 dark:text-text-primary-dark" />
        </button>
      )}

      {station ? (
        <>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark sm:px-3"
          >
            {station.code}
            <ChevronDownIcon className="h-3.5 w-3.5" />
          </button>
          <div className="hidden items-center gap-3 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark md:flex">
            <span>{localClock}</span>
            <span aria-hidden="true">·</span>
            <span>{utcClock}</span>
          </div>
        </>
      ) : (
        roleLabel && (
          <span className="min-w-0 truncate rounded-lg border border-black/10 px-2.5 py-1.5 text-sm font-semibold text-ink-900 dark:border-white/10 dark:text-text-primary-dark sm:px-3">
            {roleLabel}
          </span>
        )
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
        {notificationsEnabled && <div className="relative">
          <button
            type="button"
            onClick={() => {
              if (notificationCenter) setNotificationsOpen(open => !open);
              else onOpenNotifications?.();
            }}
            aria-label="Notificaciones"
            aria-expanded={notificationCenter ? notificationsOpen : undefined}
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
          {notificationCenter && notificationsOpen && (
            <NotificationPopover center={notificationCenter} onClose={() => setNotificationsOpen(false)} />
          )}
        </div>}

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
            aria-label={user.name}
            className="flex items-center gap-2 rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/5 sm:pr-2"
          >
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
              {initials(user.name)}
            </span>
            <span aria-hidden="true" className="hidden max-w-[12rem] truncate text-xs font-medium text-ink-900 dark:text-text-primary-dark sm:inline">{user.name}</span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-overlay mt-2 w-56 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
            >
              <div className="px-3 py-1.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                <span className="block truncate font-semibold text-ink-900 dark:text-text-primary-dark sm:hidden">{user.name}</span>
                {user.role}
                {station && (
                  <span className="mt-1 block font-mono md:hidden">{localClock} · {utcClock}</span>
                )}
              </div>
              {profileActionsEnabled && (
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
                >
                  Perfil
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout?.();
                }}
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
