'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronDownIcon } from './icons';

function isChildActive(child, { pathname, activeModuleId, useModuleNavigation }) {
  if (useModuleNavigation) return child.id === activeModuleId;
  return pathname === child.path || pathname?.startsWith(`${child.path}/`);
}

function canHover() {
  return typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
}

const childClassName = active =>
  `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
    active
      ? 'bg-accent-600/10 font-medium text-accent-600 dark:bg-accent-600/15'
      : 'text-text-secondary-light hover:bg-black/5 hover:text-ink-900 dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark'
  }`;

function ChildLink({ child, active, useModuleNavigation, onSelect, onNavigate, role }) {
  const content = <>
    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-accent-600' : 'bg-current opacity-40'}`} />
    <span className="min-w-0 flex-1 truncate">{child.label}</span>
    {Number(child.badge?.count ?? child.badge) > 0 && (
      <span className="shrink-0 rounded-full bg-signal-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {child.badge?.count ?? child.badge}
      </span>
    )}
  </>;
  if (useModuleNavigation) {
    return <button type="button" role={role} aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(child.id)} className={childClassName(active)}>{content}</button>;
  }
  return <Link href={child.path} role={role} aria-current={active ? 'page' : undefined}
    onClick={onNavigate} className={childClassName(active)}>{content}</Link>;
}

/**
 * A navigation item with sub-items. In an expanded rail or the overlay it is a
 * disclosure that starts open when a sub-item is active. In a collapsed rail it
 * opens a flyout: on hover only where the device can hover, and always on
 * click, tap or keyboard focus, so touch screens never depend on hover.
 */
export default function SidebarGroup({
  item,
  expanded,
  useModuleNavigation,
  activeModuleId,
  onSelectModule,
  onNavigate,
}) {
  const pathname = usePathname();
  const context = { pathname, activeModuleId, useModuleNavigation };
  const active = item.children.some(child => isChildActive(child, context));
  const [toggled, setToggled] = useState(null);
  const open = toggled ?? active;
  const [flyout, setFlyout] = useState(null);
  const buttonRef = useRef(null);
  const flyoutRef = useRef(null);
  const closeTimer = useRef(null);
  const panelId = useId();
  const Icon = item.icon;
  const badgeTotal = item.children.reduce((total, child) => total + Number(child.badge?.count ?? child.badge ?? 0), 0);

  useEffect(() => {
    if (!flyout) return undefined;
    const onPointer = event => {
      if (!flyoutRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setFlyout(null);
    };
    const onKey = event => {
      if (event.key === 'Escape') {
        setFlyout(null);
        buttonRef.current?.focus();
      }
    };
    const onScroll = () => setFlyout(null);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
    };
  }, [flyout]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  function openFlyout() {
    window.clearTimeout(closeTimer.current);
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setFlyout({ top: rect.top, left: rect.right + 8 });
  }

  function scheduleClose() {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout(null), 150);
  }

  function select(id) {
    setFlyout(null);
    onSelectModule?.(id);
  }

  const buttonClassName = `group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
    expanded ? '' : 'justify-center'
  } ${
    active
      ? 'bg-accent-600/10 text-accent-600 dark:bg-accent-600/15'
      : 'text-text-secondary-light hover:bg-black/5 hover:text-ink-900 dark:text-text-secondary-dark dark:hover:bg-white/5 dark:hover:text-text-primary-dark'
  }`;

  if (expanded) {
    return (
      <div>
        <button type="button" ref={buttonRef} aria-expanded={open} aria-controls={panelId}
          onClick={() => setToggled(!open)} className={buttonClassName}>
          <Icon className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left font-medium">{item.label}</span>
          {!open && badgeTotal > 0 && (
            <span className="shrink-0 rounded-full bg-signal-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{badgeTotal}</span>
          )}
          <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>
        <div id={panelId} hidden={!open} className="mt-1 space-y-0.5 border-l border-black/10 pl-2 ml-5 dark:border-white/10">
          {item.children.map(child => (
            <ChildLink key={child.id} child={child} active={isChildActive(child, context)}
              useModuleNavigation={useModuleNavigation} onSelect={select} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div onMouseEnter={() => canHover() && openFlyout()} onMouseLeave={() => canHover() && scheduleClose()}>
      <button type="button" ref={buttonRef} aria-haspopup="menu" aria-expanded={Boolean(flyout)}
        aria-label={item.label} onClick={() => (flyout ? setFlyout(null) : openFlyout())}
        onKeyDown={event => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            event.preventDefault();
            openFlyout();
            window.setTimeout(() => flyoutRef.current?.querySelector('[role="menuitem"]')?.focus(), 0);
          }
        }}
        className={buttonClassName}>
        <span aria-hidden="true" className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-signal-500 transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
        <Icon className="h-4 w-4 shrink-0" />
        {badgeTotal > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-signal-500" />}
      </button>
      {flyout && typeof document !== 'undefined' && createPortal(
        <div ref={flyoutRef} role="menu" aria-label={item.label}
          onMouseEnter={() => window.clearTimeout(closeTimer.current)}
          onMouseLeave={() => canHover() && scheduleClose()}
          style={{ top: flyout.top, left: flyout.left }}
          className="fixed z-overlay w-56 rounded-xl border border-black/10 bg-white/95 p-1.5 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
          <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">{item.label}</p>
          {item.children.map(child => (
            <ChildLink key={child.id} role="menuitem" child={child} active={isChildActive(child, context)}
              useModuleNavigation={useModuleNavigation} onSelect={select}
              onNavigate={() => { setFlyout(null); onNavigate?.(); }} />
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
