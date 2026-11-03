'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '../../../i18n/LanguageScope';
import { ChevronLeftIcon, ChevronRightIcon, LogOutIcon, XIcon } from '../../shell/components/icons';
import { OCC_NAV_SECTIONS } from '../navigation';
import { occShellMessages } from './occShellMessages';

// Marca oficial completa (isotipo blanco/naranja para fondo oscuro). El riel es
// navy en ambos temas, así que siempre se usa la variante para fondo oscuro.
const MARK_SRC = '/brand/elevant-mark-dark.png';

function initials(name = '') {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
}

function isActivePath(pathname, path) {
  return pathname === path || pathname?.startsWith(`${path}/`);
}

function Brand({ expanded, t }) {
  return (
    <div className={`flex items-center gap-2.5 ${expanded ? '' : 'justify-center'}`}>
      {/* El contenedor reserva el alto; el asset conserva su proporción sin recorte. */}
      <Image src={MARK_SRC} alt={expanded ? '' : t('brand')} width={560} height={401} priority
        className="h-7 w-auto shrink-0 object-contain" />
      {expanded && <span className="text-[15px] font-bold tracking-[0.22em] text-white">{t('brand')}</span>}
    </div>
  );
}

function Identity({ expanded, t }) {
  if (!expanded) {
    return <p className="text-center font-mono text-[11px] font-semibold tracking-wider text-occ-nav-accent"
      title={`${t('departmentShort')} · ${t('station')}`}>PUJ</p>;
  }
  return (
    <div className="rounded-xl border border-occ-nav-line bg-white/[0.03] px-3 py-2.5">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-occ-nav-accent">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-occ-nav-accent" />
        {t('departmentShort')}
      </p>
      <p className="mt-1 text-sm font-semibold leading-tight text-white">{t('department')}</p>
      <p className="mt-0.5 truncate font-mono text-xs text-occ-nav-muted" title={t('station')}>
        PUJ · {t('stationShort')}
      </p>
    </div>
  );
}

function NavLink({ item, label, expanded, active, onNavigate }) {
  const Icon = item.icon;
  const badgeCount = typeof item.badge === 'number' ? item.badge : item.badge?.count;
  const hasBadge = Number.isFinite(badgeCount) && badgeCount > 0;
  return (
    <Link href={item.path} onClick={onNavigate} aria-current={active ? 'page' : undefined}
      aria-label={expanded ? undefined : label}
      className={`group relative flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
        expanded ? '' : 'justify-center'
      } ${active
        ? 'bg-occ-nav-active font-semibold text-white'
        : 'text-occ-nav-text hover:bg-occ-nav-hover hover:text-white'}`}>
      <span aria-hidden="true" className={`absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-occ-nav-accent transition-opacity ${
        active ? 'opacity-100' : 'opacity-0'}`} />
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-occ-nav-accent' : ''}`} />
      {expanded && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {expanded && hasBadge && <span className="shrink-0 rounded-full bg-signal-500 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-900">
        {badgeCount > 99 ? '99+' : badgeCount}</span>}
      {!expanded && hasBadge && <span aria-hidden="true" className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-signal-500" />}
      {!expanded && <span aria-hidden="true"
        className="pointer-events-none absolute left-full top-1/2 z-20 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}</span>}
    </Link>
  );
}

function SidebarBody({ navigation, user, onLogout, expanded, presentation, onToggle, onNavigate }) {
  const { t } = useTranslation(occShellMessages);
  const pathname = usePathname();
  const navLabel = item => {
    const key = `nav.${item.id}`;
    const text = t(key);
    return text === key ? item.label : text;
  };
  const byId = new Map(navigation.map(item => [item.id, item]));
  const sections = OCC_NAV_SECTIONS
    .map(section => ({ ...section, items: section.items.map(id => byId.get(id)).filter(Boolean) }))
    .filter(section => section.items.length > 0);

  return (
    <div data-occ-nav="" className="flex h-full min-w-0 flex-col bg-occ-nav text-occ-nav-text">
      <div className={`flex items-center gap-2 px-4 pb-4 pt-5 ${expanded ? 'justify-between' : 'flex-col'}`}>
        <Brand expanded={expanded} t={t} />
        {presentation === 'inline' && (
          <button type="button" onClick={onToggle} aria-label={expanded ? t('collapse') : t('expand')}
            aria-expanded={expanded}
            className="flex h-8 w-8 items-center justify-center rounded-md text-occ-nav-muted hover:bg-occ-nav-hover hover:text-white">
            {expanded ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
          </button>
        )}
        {presentation === 'overlay' && (
          <button type="button" onClick={onToggle} aria-label={t('closeMenu')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-occ-nav-muted hover:bg-occ-nav-hover hover:text-white">
            <XIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 pb-3"><Identity expanded={expanded} t={t} /></div>

      <nav aria-label={t('navLabel')} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {sections.map(section => (
          <div key={section.id} className="mt-3 first:mt-1">
            {expanded
              ? <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-occ-nav-muted">
                {t(`sections.${section.id}`)}</p>
              : <div aria-hidden="true" className="mx-auto mb-2 h-px w-6 bg-occ-nav-line" />}
            <ul className="space-y-0.5">
              {section.items.map(item => (
                <li key={item.id}>
                  <NavLink item={item} label={navLabel(item)}
                    expanded={expanded} active={isActivePath(pathname, item.path)} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-occ-nav-line p-3">
        <div className={`flex items-center gap-2.5 ${expanded ? '' : 'flex-col'}`}>
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
            {initials(user?.name)}
          </span>
          {expanded && <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-white">{user?.name}</span>
            <span className="block truncate text-xs text-occ-nav-muted">{user?.role}</span>
          </span>}
          {onLogout && <button type="button" onClick={onLogout} aria-label={t('logout')} title={t('logout')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-occ-nav-muted hover:bg-occ-nav-hover hover:text-white">
            <LogOutIcon className="h-4 w-4" />
          </button>}
        </div>
      </div>
    </div>
  );
}

export default function OccSidebar({
  navigation = [], user, onLogout, breakpoint, railVisible, railExpanded, overlayOpen, onToggle, onCloseOverlay,
}) {
  const showOverlay = breakpoint !== 'desktop';
  return (
    <>
      {railVisible && (
        <aside className={`shrink-0 border-r border-occ-nav-line transition-[width] duration-200 ease-out ${
          railExpanded ? 'w-[248px]' : 'w-[72px]'}`}>
          <SidebarBody navigation={navigation} user={user} onLogout={onLogout} expanded={railExpanded}
            presentation="inline" onToggle={onToggle} />
        </aside>
      )}
      {showOverlay && (
        <>
          <div aria-hidden="true" onClick={onCloseOverlay}
            className={`fixed inset-0 z-overlay bg-ink-900/50 transition-opacity duration-200 ${
              overlayOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
          <aside aria-hidden={!overlayOpen} inert={!overlayOpen ? true : undefined}
            className={`fixed inset-y-0 left-0 z-overlay w-[min(85vw,280px)] shadow-2xl transition-transform duration-200 ease-out ${
              overlayOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <SidebarBody navigation={navigation} user={user} onLogout={onLogout} expanded
              presentation="overlay" onToggle={onCloseOverlay} onNavigate={onCloseOverlay} />
          </aside>
        </>
      )}
    </>
  );
}
