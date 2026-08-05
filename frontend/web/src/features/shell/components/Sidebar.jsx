import { useState } from 'react';
import SidebarItem from './SidebarItem';
import { ChevronDownIcon } from '../../dashboard/components/icons';

const LOGO_URL = '/brand/elevant-logo.png';

// Crop coordinates picked from the source square logo (1254x1254): the mark
// (the three swept bars) sits roughly in the top third, above the wordmark
// and tagline. Cropped via background-position/-size rather than a second
// asset, since only one brand PNG exists today.
function LogoMark({ className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 rounded-lg bg-no-repeat ${className}`}
      style={{
        backgroundImage: `url(${LOGO_URL})`,
        backgroundSize: '95.5px 95.5px',
        backgroundPosition: '-32.6px -22.4px',
      }}
    />
  );
}

function UserMenu({ user, expanded, presentation }) {
  const [open, setOpen] = useState(false);

  const menuPosition =
    presentation === 'overlay' || expanded
      ? 'bottom-full left-0 mb-2 w-full'
      : 'bottom-0 left-full ml-2 w-44';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-xl p-2 text-left hover:bg-black/5 dark:hover:bg-white/5 ${
          expanded ? '' : 'justify-center'
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
          {user.name
            .split(' ')
            .map(part => part[0])
            .slice(0, 2)
            .join('')}
        </span>
        {expanded && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink-900 dark:text-text-primary-dark">
              {user.name}
            </span>
            <span className="block truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {user.role}
            </span>
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-30 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card ${menuPosition}`}
        >
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
            className="block w-full px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Configuración
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
  );
}

function SidebarContent({
  expanded,
  presentation,
  modules,
  activeModuleId,
  onSelectModule,
  badgeCounts,
  user,
  onToggle,
}) {
  return (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className={`mb-2 flex items-center gap-2 px-1 py-2 ${expanded ? '' : 'justify-center'}`}>
        <LogoMark className="h-8 w-8" />
        {expanded && (
          <span className="truncate text-sm font-bold tracking-wide text-ink-900 dark:text-text-primary-dark">
            ELEVANT
          </span>
        )}
        {presentation === 'inline' && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? 'Contraer barra lateral' : 'Expandir barra lateral'}
            className={`rounded-lg p-1.5 text-text-secondary-light hover:bg-black/5 hover:text-ink-900 dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark ${
              expanded ? 'ml-auto' : ''
            }`}
          >
            <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${expanded ? '-rotate-90' : 'rotate-90'}`} />
          </button>
        )}
      </div>

      <nav aria-label="Navegación principal" className="flex-1 space-y-1 overflow-y-auto">
        {modules.map(module => (
          <SidebarItem
            key={module.id}
            icon={module.icon}
            label={module.label}
            expanded={expanded}
            active={module.id === activeModuleId}
            badge={badgeCounts[module.id]}
            onClick={() => onSelectModule(module.id)}
          />
        ))}
      </nav>

      <div className="mt-2 border-t border-black/5 pt-2 dark:border-white/5">
        <UserMenu user={user} expanded={expanded} presentation={presentation} />
      </div>
    </div>
  );
}

export default function Sidebar({
  modules,
  activeModuleId,
  onSelectModule,
  badgeCounts = {},
  user,
  breakpoint,
  railVisible,
  railExpanded,
  overlayOpen,
  onToggle,
  onCloseOverlay,
}) {
  const showOverlayLayer = breakpoint !== 'desktop';

  return (
    <>
      {railVisible && (
        <aside
          className={`shrink-0 border-r border-black/5 bg-white/70 backdrop-blur-md transition-[width] duration-200 ease-in-out dark:border-white/5 dark:bg-surface-dark-card ${
            railExpanded ? 'w-[260px]' : 'w-[72px]'
          }`}
        >
          <SidebarContent
            expanded={railExpanded}
            presentation="inline"
            modules={modules}
            activeModuleId={activeModuleId}
            onSelectModule={onSelectModule}
            badgeCounts={badgeCounts}
            user={user}
            onToggle={onToggle}
          />
        </aside>
      )}

      {showOverlayLayer && (
        <div
          aria-hidden={!overlayOpen}
          className={`fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-sm transition-opacity duration-200 ${
            overlayOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={onCloseOverlay}
        />
      )}

      {showOverlayLayer && (
        <aside
          aria-hidden={!overlayOpen}
          className={`fixed inset-y-0 left-0 z-50 w-[260px] border-r border-black/5 bg-white/95 backdrop-blur-md transition-transform duration-200 ease-in-out dark:border-white/5 dark:bg-surface-dark-card ${
            overlayOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <SidebarContent
            expanded
            presentation="overlay"
            modules={modules}
            activeModuleId={activeModuleId}
            onSelectModule={onSelectModule}
            badgeCounts={badgeCounts}
            user={user}
            onToggle={onCloseOverlay}
          />
        </aside>
      )}
    </>
  );
}
