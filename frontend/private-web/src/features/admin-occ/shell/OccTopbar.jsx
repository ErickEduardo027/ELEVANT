'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from '../../../i18n/LanguageScope';
import { SUPPORTED_LANGUAGES } from '../../../i18n/languageStore';
import { BellIcon, MenuIcon } from '../../shell/components/icons';
import { ADMIN_OCC_BASE_PATH } from '../navigation';
import { useOptionalOccShell } from './occShellContext';
import OccShellOverlays from './OccShellOverlays';
import { occShellMessages } from './occShellMessages';

function useUtcClock(locale) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!now) return { iso: '', text: '--:--' };
  return {
    iso: now.toISOString(),
    text: now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }),
  };
}

function LanguageToggle({ language, setLanguage, t }) {
  return (
    <div role="group" aria-label={t('language')}
      className="flex h-8 items-center rounded-md border border-occ-line bg-occ-panel-muted p-0.5 text-[11px] font-semibold">
      {SUPPORTED_LANGUAGES.map(code => (
        <button key={code} type="button" aria-pressed={code === language} aria-label={t(`languageOption.${code}`)}
          onClick={() => setLanguage(code)}
          className={`h-full rounded px-2 transition-colors ${code === language
            ? 'bg-occ-panel text-occ-text shadow-sm ring-1 ring-occ-line'
            : 'text-occ-muted hover:text-occ-text'}`}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function MobileUserMenu({ user, onLogout, t }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = event => {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    const onPointer = event => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const initials = (user?.name ?? '').split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative sm:hidden">
      <button ref={buttonRef} type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={t('userMenu', { name: user?.name ?? '' })} onClick={() => setOpen(value => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
        {initials}
      </button>
      {open && (
        <div ref={menuRef} role="menu"
          className="absolute right-0 top-full z-overlay mt-2 w-60 rounded-lg border border-occ-line bg-occ-panel py-1 shadow-xl">
          <div className="px-3 py-2 text-xs text-occ-muted">
            <span className="block truncate text-sm font-semibold text-occ-text">{user?.name}</span>
            {user?.role}
          </div>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogout?.(); }}
            className="block min-h-10 w-full px-3 text-left text-sm font-medium text-occ-danger hover:bg-occ-panel-muted">
            {t('logout')}
          </button>
        </div>
      )}
    </div>
  );
}

// The OCC is dark only, so this bar has no theme button: the `theme` and
// `onToggleTheme` props that AppShell sends to every top bar are not read here.
// Inside OccShellProvider the bell reads the shell's notices (AppShell reads none in
// the OCC); on its own, as in its tests, it keeps the props AppShell sends.
export default function OccTopbar({
  navigation = [], notificationsCount = 0, notificationsEnabled = true,
  user, onOpenMenu, onOpenNotifications, onLogout,
}) {
  const { t, language, locale, setLanguage } = useTranslation(occShellMessages);
  const pathname = usePathname();
  const router = useRouter();
  const shell = useOptionalOccShell();
  const clock = useUtcClock(locale);
  const current = navigation.find(item => pathname === item.path || pathname?.startsWith(`${item.path}/`));
  const bellCount = shell ? shell.notices.unreadCount : notificationsCount;
  const bellEnabled = shell ? shell.notices.status !== 'forbidden' : notificationsEnabled;
  const openNotifications = shell ? () => router.push(`${ADMIN_OCC_BASE_PATH}/notifications`) : onOpenNotifications;

  return (
    <header className="relative z-nav flex h-14 shrink-0 items-center gap-3 border-b border-occ-line bg-occ-panel px-3 sm:px-5">
      {onOpenMenu && (
        <button type="button" onClick={onOpenMenu} aria-label={t('openMenu')}
          className="flex h-9 w-9 items-center justify-center rounded-md text-occ-text hover:bg-occ-panel-muted sm:hidden">
          <MenuIcon className="h-5 w-5" />
        </button>
      )}

      <p className="flex min-w-0 items-center gap-2 text-sm">
        <span className="hidden font-mono text-xs font-semibold tracking-wider text-occ-accent sm:inline">OCC · PUJ</span>
        <span aria-hidden="true" className="hidden text-occ-line-strong sm:inline">/</span>
        <span className="truncate font-semibold text-occ-text">{current ? t(`nav.${current.id}`) : t('department')}</span>
      </p>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <p className="hidden items-baseline gap-1.5 rounded-md px-2 font-mono text-xs text-occ-muted md:flex"
          aria-label={`${t('utcClock')}: ${clock.text}`}>
          <span className="text-[10px] font-semibold tracking-wider">UTC</span>
          <time dateTime={clock.iso} className="text-sm font-medium text-occ-text">{clock.text}</time>
        </p>
        <span aria-hidden="true" className="hidden h-5 w-px bg-occ-line md:block" />

        <LanguageToggle language={language} setLanguage={setLanguage} t={t} />

        {bellEnabled && (
          <button type="button" onClick={openNotifications}
            aria-label={bellCount > 0 ? t('notificationsUnread', { count: bellCount }) : t('notifications')}
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-occ-text hover:bg-occ-panel-muted">
            <BellIcon className="h-[18px] w-[18px]" />
            {bellCount > 0 && (
              <span data-testid="notifications-badge" aria-hidden="true"
                className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-500 px-1 font-mono text-[10px] font-semibold text-ink-900">
                {bellCount > 99 ? '99+' : bellCount}
              </span>
            )}
          </button>
        )}

        <MobileUserMenu user={user} onLogout={onLogout} t={t} />
      </div>
      <OccShellOverlays />
    </header>
  );
}
