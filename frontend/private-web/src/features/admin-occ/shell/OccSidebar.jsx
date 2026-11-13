'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { ChevronLeftIcon, ChevronRightIcon, LogOutIcon, XIcon } from '../../shell/components/icons';
import { OCC_NAV_SECTIONS } from '../navigation';
import { useOptionalOccShell } from './occShellContext';
import { occNavLabel } from './occNavLabel';
import OccSkipLink from './OccSkipLink';
import { occShellMessages } from './occShellMessages';
import { countPlateText, railBadges } from './railBadges';

// The official mark for a dark ground (white and orange isotype): the rail is always the dark «Hangar» slab.
const MARK_SRC = '/brand/elevant-mark-dark.png';

// Rows are 36 px high, 44 px on a touch screen (design C.2 and H.2).
const ROW = 'min-h-9 [@media(pointer:coarse)]:min-h-11';
// An icon button of the rail: muted at rest, lit under the pointer.
const RAIL_BUTTON = 'flex h-9 w-9 shrink-0 items-center justify-center rounded text-occ-nav-muted hover:bg-occ-nav-hover '
  + 'hover:text-occ-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
// A count plate is neutral: the figure in mono on a raised slab, never a signal colour.
const COUNT_PLATE = 'rounded-sm bg-occ-panel-raised px-1 font-mono text-xs font-semibold tabular-nums text-occ-text';
// The plate with the user's initials, as in the status bar's account menu.
const INITIALS_PLATE = 'flex h-8 min-w-8 shrink-0 items-center justify-center rounded-sm border border-occ-line-strong '
  + 'bg-occ-panel-raised px-1.5 text-xs font-semibold text-occ-text';
// A visible name of the collapsed rail (elevation 2 without a shadow). Its transparent left padding bridges the gap
// to the control, so the pointer can move onto the name without leaving the control.
const HINT = 'fixed z-overlay flex -translate-y-1/2 pl-5';
const HINT_LABEL = 'whitespace-nowrap rounded-[var(--occ-radius-overlay)] border border-occ-line-strong bg-occ-panel-raised '
  + 'px-2 py-1 text-xs font-medium text-occ-text';
// The id of the logout control among the rail's hints; the others are module ids.
const LOGOUT = 'logout';
const NO_HINTS = Object.freeze({ hover: null, focus: null });

function initialsOf(name = '') {
  return name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
}

function isActivePath(pathname, path) {
  return pathname === path || pathname?.startsWith(`${path}/`);
}

// Beside a control's right edge and centred on it, in viewport coordinates.
function besideOf(element) {
  const box = element.getBoundingClientRect();
  return { top: box.top + box.height / 2, left: box.right };
}

/**
 * The visible names of a collapsed rail (design C.2 and H.2): a control's name shows beside it while the pointer is
 * over it or while it has focus, and Esc dismisses it. It is drawn `fixed` from the control's box because the rail's nav
 * scrolls, and a scroller clips any label placed against its content, as it clipped the earlier hover labels of the rail.
 * The pointer wins over focus when both point at a control. `enabled` is off for an expanded rail, whose names are on
 * screen; leaving a control always clears its hint, so none lingers after the rail changes width.
 */
function useRailHints(enabled) {
  const [hints, setHints] = useState(NO_HINTS);
  const anchors = useRef({ hover: null, focus: null });

  const show = useCallback((trigger, id, element) => {
    anchors.current[trigger] = element;
    setHints(current => ({ ...current, [trigger]: { id, ...besideOf(element) } }));
  }, []);
  const hide = useCallback(trigger => {
    anchors.current[trigger] = null;
    setHints(current => (current[trigger] ? { ...current, [trigger]: null } : current));
  }, []);
  const dismiss = useCallback(() => {
    anchors.current = { hover: null, focus: null };
    setHints(current => (current.hover || current.focus ? NO_HINTS : current));
  }, []);
  // The nav scrolled under a hint: the hint follows its control.
  const follow = useCallback(() => {
    const { hover, focus } = anchors.current;
    const moved = { hover: hover ? besideOf(hover) : null, focus: focus ? besideOf(focus) : null };
    setHints(current => (current.hover || current.focus ? {
      hover: current.hover && moved.hover ? { ...current.hover, ...moved.hover } : current.hover,
      focus: current.focus && moved.focus ? { ...current.focus, ...moved.focus } : current.focus,
    } : current));
  }, []);

  const shown = enabled ? hints.hover ?? hints.focus : null;
  const showing = shown !== null;
  useEffect(() => {
    if (!showing) return undefined;
    const onKeyDown = event => { if (event.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dismiss, showing]);

  const triggers = useCallback(id => ({
    onMouseEnter: enabled ? event => show('hover', id, event.currentTarget) : undefined,
    onFocus: enabled ? event => show('focus', id, event.currentTarget) : undefined,
    onMouseLeave: () => hide('hover'),
    onBlur: () => hide('focus'),
  }), [enabled, hide, show]);

  return { shown, triggers, follow, dismiss };
}

function RailHint({ hint, label }) {
  return (
    <span aria-hidden="true" data-occ-rail-hint="" style={{ top: hint.top, left: hint.left }} className={HINT}>
      <span className={HINT_LABEL}>{label}</span>
    </span>
  );
}

function Brand({ expanded, t }) {
  return (
    <div className={`flex items-center gap-2.5 ${expanded ? '' : 'justify-center'}`}>
      {/* The box keeps the height; the asset keeps its proportions without cropping. */}
      <Image src={MARK_SRC} alt={expanded ? '' : t('brand')} width={560} height={401} loading="eager"
        className="h-7 w-auto shrink-0 object-contain" />
      {expanded ? <span className="text-base font-bold text-occ-nav-text">{t('brand')}</span> : null}
    </div>
  );
}

/**
 * A module of the rail. Its accessible name is its label alone: the count plate is hidden from screen readers, which
 * hear the count as the link's description («3 sin leer»). Collapsed, the label is the link's `aria-label` and shows
 * beside it as a hint.
 */
function NavLink({ item, label, count, description, expanded, active, hint, triggers, onActivate }) {
  const Icon = item.icon;
  const descriptionId = useId();
  const plate = count > 0 ? countPlateText(count) : null;
  return (
    <Link href={item.path} onClick={onActivate} aria-current={active ? 'page' : undefined}
      aria-label={expanded ? undefined : label} aria-describedby={plate ? descriptionId : undefined}
      {...triggers(item.id)}
      className={`relative flex items-center gap-3 rounded px-3 text-sm transition-colors ${ROW} ${
        expanded ? '' : 'justify-center'} ${active
        ? 'bg-occ-nav-active font-semibold text-occ-text'
        : 'text-occ-nav-text hover:bg-occ-nav-hover hover:text-occ-text'}`}>
      {/* The 2 px bar is a border, not a fill: forced-colours mode keeps borders (as a system colour) and drops
          backgrounds, so the active module stays marked there too (design H.2). */}
      {active ? (
        <span aria-hidden="true" data-occ-active-bar=""
          className="absolute left-0 top-1/2 h-5 -translate-y-1/2 border-l-2 border-occ-nav-accent" />
      ) : null}
      <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-occ-nav-accent' : ''}`} />
      {expanded ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
      {plate ? (
        <span aria-hidden="true" data-occ-count-plate=""
          className={`${COUNT_PLATE} ${expanded ? 'shrink-0 leading-5' : 'absolute right-0.5 top-0.5 leading-4'}`}>
          {plate}
        </span>
      ) : null}
      {plate ? <span id={descriptionId} hidden>{description}</span> : null}
      {hint ? <RailHint hint={hint} label={label} /> : null}
    </Link>
  );
}

function SidebarBody({ navigation, badges, user, onLogout, expanded, presentation, onToggle, onNavigate }) {
  const { t } = useTranslation(occShellMessages);
  const pathname = usePathname();
  const groupId = useId();
  const { shown, triggers, follow, dismiss } = useRailHints(!expanded);
  const hintFor = id => (shown?.id === id ? shown : null);
  const byId = new Map(navigation.map(item => [item.id, item]));
  // Only the modules the department access allows reach the rail (allowedNavigation); a group left empty goes.
  const sections = OCC_NAV_SECTIONS
    .map(section => ({ ...section, items: section.items.map(id => byId.get(id)).filter(Boolean) }))
    .filter(section => section.items.length > 0);
  const initials = initialsOf(user?.name);
  const activate = () => {
    dismiss();
    onNavigate?.();
  };

  return (
    <div data-occ-nav="" className="flex h-full min-w-0 flex-col bg-occ-nav text-occ-nav-text">
      <div className={`flex items-center gap-2 px-4 pb-4 pt-5 ${expanded ? 'justify-between' : 'flex-col'}`}>
        <Brand expanded={expanded} t={t} />
        {presentation === 'inline' ? (
          <button type="button" onClick={onToggle} aria-label={expanded ? t('collapse') : t('expand')}
            aria-expanded={expanded} className={RAIL_BUTTON}>
            {expanded ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
          </button>
        ) : null}
        {presentation === 'overlay' ? (
          <button type="button" onClick={onToggle} aria-label={t('closeMenu')} className={RAIL_BUTTON}>
            <XIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <nav aria-label={t('navLabel')} onScroll={follow} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        {sections.map(section => {
          const labelId = `${groupId}-${section.id}`;
          return (
            <div key={section.id} className={expanded ? 'mt-4 first:mt-1' : 'mt-2 first:mt-0'}>
              {/* Collapsed, the group keeps its name for screen readers and shows a 1 px rule. */}
              <p id={labelId} className={expanded ? 'px-3 pb-1 text-xs font-semibold text-occ-nav-muted' : 'sr-only'}>
                {t(`sections.${section.id}`)}
              </p>
              {expanded ? null : <div aria-hidden="true" data-occ-group-rule="" className="mx-auto mb-2 h-px w-6 bg-occ-nav-line" />}
              <ul aria-labelledby={labelId} className="space-y-0.5">
                {section.items.map(item => {
                  const label = occNavLabel(t, item);
                  const count = badges[item.id] ?? 0;
                  return (
                    <li key={item.id}>
                      <NavLink item={item} label={label} count={count}
                        description={count > 0 ? t('unreadDescription', { count }) : null} expanded={expanded}
                        active={isActivePath(pathname, item.path)} hint={hintFor(item.id)} triggers={triggers}
                        onActivate={activate} />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-occ-nav-line p-3">
        {expanded ? (
          <>
            <div className="flex items-center gap-2.5">
              {initials ? <span aria-hidden="true" className={INITIALS_PLATE}>{initials}</span> : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-occ-nav-text">{user?.name}</span>
                <span className="block truncate text-xs text-occ-nav-muted">{user?.role}</span>
              </span>
            </div>
            {onLogout ? (
              <button type="button" onClick={onLogout}
                className={`mt-2 flex w-full items-center gap-2 rounded px-2 text-sm font-medium text-occ-nav-text hover:bg-occ-nav-hover hover:text-occ-text ${ROW}`}>
                <LogOutIcon className="h-4 w-4 shrink-0" />
                {t('logout')}
              </button>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {initials ? <span aria-hidden="true" className={INITIALS_PLATE}>{initials}</span> : null}
            {onLogout ? (
              <button type="button" onClick={() => { dismiss(); onLogout(); }} aria-label={t('logout')}
                {...triggers(LOGOUT)} className={`relative ${RAIL_BUTTON}`}>
                <LogOutIcon className="h-4 w-4" />
                {hintFor(LOGOUT) ? <RailHint hint={hintFor(LOGOUT)} label={t('logout')} /> : null}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The OCC rail (design C.2): the 14 modules in the four groups of the controller's day (En vivo, Planificar, Revisar,
 * Estación), the active module marked with the raised slab, a 2 px accent bar and `aria-current="page"`, and neutral
 * count plates fed by the notices the shell already read (Chat interno, Revisión, Notificaciones). It expands to 248 px
 * and collapses to 72 px; below 1024 px it also opens as an overlay. The station lives in the status bar, so the rail
 * has no identity card. The skip link goes first, so it is the frame's first focusable element.
 */
export default function OccSidebar({
  navigation = [], user, onLogout, breakpoint, railVisible, railExpanded, overlayOpen, onToggle, onCloseOverlay,
}) {
  const notices = useOptionalOccShell()?.notices?.items;
  const badges = useMemo(() => railBadges(notices), [notices]);
  const showOverlay = breakpoint !== 'desktop';
  return (
    <>
      <OccSkipLink />
      {railVisible ? (
        <aside className={`shrink-0 border-r border-occ-nav-line transition-[width] duration-200 ease-out motion-reduce:transition-none ${
          railExpanded ? 'w-[248px]' : 'w-[72px]'}`}>
          <SidebarBody navigation={navigation} badges={badges} user={user} onLogout={onLogout} expanded={railExpanded}
            presentation="inline" onToggle={onToggle} />
        </aside>
      ) : null}
      {showOverlay ? (
        <>
          <div aria-hidden="true" onClick={onCloseOverlay}
            className={`fixed inset-0 z-overlay bg-occ-scrim transition-opacity duration-200 motion-reduce:transition-none ${
              overlayOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
          <aside aria-hidden={!overlayOpen} inert={!overlayOpen ? true : undefined}
            className={`fixed inset-y-0 left-0 z-overlay w-[min(85vw,280px)] border-r border-occ-nav-line transition-transform duration-200 ease-out motion-reduce:transition-none ${
              overlayOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <SidebarBody navigation={navigation} badges={badges} user={user} onLogout={onLogout} expanded
              presentation="overlay" onToggle={onCloseOverlay} onNavigate={onCloseOverlay} />
          </aside>
        </>
      ) : null}
    </>
  );
}
