'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from '../../../i18n/LanguageScope';
import { occShellMessages } from './occShellMessages';
import { OCC_NAV_SECTIONS } from '../navigation';
import { OccNotificationBell } from '../notifications/OperationalNotificationCenter';
import { ChevronRightIcon, MenuIcon, MoonIcon, SunIcon } from '../../shell/components/icons';
import styles from './OccChrome.module.css';

export function NoOccSidebar() { return null; }

const words = {
  es: { account: 'Cuenta', language: 'Idioma', navigation: 'Navegación principal', menu: 'Abrir navegación', utc: 'Hora UTC',
    groups: { monitoring: 'Panorama', operations: 'Operación', communication: 'Comunicación', administration: 'Administración' } },
  en: { account: 'Account', language: 'Language', navigation: 'Main navigation', menu: 'Open navigation', utc: 'UTC time',
    groups: { monitoring: 'Overview', operations: 'Operations', communication: 'Communication', administration: 'Administration' } },
};

export default function OccHorizontalHeader({ navigation = [], user, onLogout, theme, onToggleTheme, notificationCenter, notificationsEnabled = true }) {
  const { t, language, locale, setLanguage } = useTranslation(occShellMessages);
  const copy = words[language] ?? words.es;
  const pathname = usePathname();
  const active = item => pathname === item.path || pathname?.startsWith(item.path + '/');
  const label = item => item.id === 'users' ? (language === 'en' ? 'Users' : 'Usuarios') : t('nav.' + item.id);
  const groups = OCC_NAV_SECTIONS.map(section => ({ ...section, label: copy.groups[section.id],
    links: section.items.map(id => navigation.find(item => item.id === id)).filter(Boolean),
  })).filter(group => group.links.length);
  const current = navigation.find(active);
  const groupActive = group => group.links.some(active) || (group.id === 'operations' && ['positions-map', 'flight-monitoring'].includes(current?.id));
  const signature = groups.map(group => group.id + ':' + group.links.map(item => item.id).join(',')).join('|');
  const [compact, setCompact] = useState(false);
  const [menu, setMenu] = useState(null);
  const [clock, setClock] = useState('');
  const root = useRef(null);
  const brand = useRef(null);
  const actions = useRef(null);
  const measure = useRef(null);
  const panel = useRef(null);
  const mobileTrigger = useRef(null);
  const profileTrigger = useRef(null);
  const compactRef = useRef(false);
  const menuRef = useRef(null);
  useLayoutEffect(() => { menuRef.current = menu; }, [menu]);

  useLayoutEffect(() => {
    const fit = () => {
      if (!root.current || !measure.current || !brand.current || !actions.current) return;
      const css = getComputedStyle(root.current);
      const available = root.current.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
        - brand.current.getBoundingClientRect().width - actions.current.getBoundingClientRect().width - 24;
      const next = window.innerWidth < 768 || measure.current.scrollWidth > available;
      if (next !== compactRef.current) {
        compactRef.current = next;
        setCompact(next);
        if (menuRef.current) {
          setMenu(null);
          requestAnimationFrame(() => {
            if (next) mobileTrigger.current?.focus();
            else root.current?.querySelector('nav a, nav button')?.focus();
          });
        }
      }
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    [root.current, actions.current, brand.current].filter(Boolean).forEach(node => observer?.observe(node));
    window.addEventListener('resize', fit);
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) fit(); });
    return () => { alive = false; observer?.disconnect(); window.removeEventListener('resize', fit); };
  }, [language, signature]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }));
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, [locale]);

  useEffect(() => {
    if (!menu) return undefined;
    const items = () => [...(panel.current?.querySelectorAll('[role="menuitem"]') ?? [])];
    const options = items();
    (menu.last ? options.at(-1) : options.find(item => item.getAttribute('aria-current') === 'page') ?? options[0])?.focus();
    const outside = event => {
      if (!panel.current?.contains(event.target) && !menu.anchor.contains(event.target)) setMenu(null);
    };
    const key = event => {
      if (event.key === 'Escape') {
        event.preventDefault(); setMenu(null); menu.anchor.focus();
      } else if (panel.current?.contains(document.activeElement)) {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const list = items();
          const index = list.indexOf(document.activeElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
          list[next]?.focus();
        } else if (event.key === 'Tab') {
          const outsideItems = [...document.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')]
            .filter(item => item.getClientRects().length && !item.closest('[inert],[aria-hidden="true"]') && !panel.current?.contains(item));
          const target = outsideItems[outsideItems.indexOf(menu.anchor) + (event.shiftKey ? -1 : 1)];
          if (target) { event.preventDefault(); setMenu(null); target.focus(); }
          else { setMenu(null); menu.anchor.focus(); }
        }
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [menu]);

  // A route transition closes the previous popup without remounting this header.
  if (menu && menu.pathname !== pathname) setMenu(null);
  const open = (id, event, last = false) => { const anchor = event.currentTarget; setMenu(value => value?.id === id ? null : { id, anchor, pathname, last }); };
  const triggerKey = id => event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(id, event, event.key === 'ArrowUp'); }
  };
  const navLink = (item, popup = false) => <Link key={item.id} href={item.path} role={popup ? 'menuitem' : undefined}
    aria-current={active(item) ? 'page' : undefined} className={popup ? styles.menuItem : styles.navLink} onClick={() => setMenu(null)}>{label(item)}</Link>;
  const initials = (user?.name ?? '').split(' ').filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  return <header ref={root} data-occ-horizontal data-compact={compact} className={styles.header}>
    <Link ref={brand} href="/admin-occ/dashboard" className={styles.brand} aria-label="ELEVANT">
      <span className={styles.brandMark}>
        <Image className={styles.logoLight} src="/brand/elevant-mark-light.png" alt="" width={560} height={390} priority />
        <Image className={styles.logoDark} src="/brand/elevant-mark-dark.png" alt="" width={560} height={401} priority />
      </span>
      <span className={styles.wordmark}>ELEVANT</span>
    </Link>
    <div ref={measure} aria-hidden="true" className={styles.measure}>{groups.map(group => <span key={group.id} className={styles.navLink}>
      {group.id === 'monitoring' ? label(group.links[0]) : group.label}{group.id !== 'monitoring' && <ChevronRightIcon className="h-3 w-3 rotate-90" />}
    </span>)}</div>
    <nav className={styles.navigation} aria-label={copy.navigation}>{groups.map(group => group.id === 'monitoring' ? navLink(group.links[0]) :
      <div key={group.id} className={styles.anchor}>
        <button type="button" className={styles.navLink} data-active={groupActive(group)} aria-haspopup="menu" aria-expanded={menu?.id === group.id}
          onClick={event => open(group.id, event)} onKeyDown={triggerKey(group.id)}>{group.label}<ChevronRightIcon className="h-3 w-3 rotate-90" /></button>
        {menu?.id === group.id && <div ref={panel} role="menu" aria-label={group.label} className={styles.menu}>{group.links.map(item => navLink(item, true))}</div>}
      </div>)}</nav>
    <div className={styles.mobileAnchor}>
      <button ref={mobileTrigger} type="button" className={styles.iconHit} aria-label={copy.menu} aria-haspopup="menu" aria-expanded={menu?.id === 'mobile'}
        onClick={event => open('mobile', event)} onKeyDown={triggerKey('mobile')}><MenuIcon className="h-5 w-5" /></button>
      {menu?.id === 'mobile' && <nav ref={panel} role="menu" aria-label={copy.navigation} className={styles.mobileMenu}>{groups.map(group =>
        <div key={group.id} role="group" aria-label={group.label} className={styles.mobileGroup}>
          {group.id !== 'monitoring' && <p className={styles.groupLabel}>{group.label}</p>}
          {group.links.map(item => navLink(item, true))}
        </div>)}</nav>}
    </div>
    <span className={styles.mobileCurrent}>{current ? label(current) : 'OCC'}</span>
    <div ref={actions} className={styles.actions}>
      {notificationsEnabled && notificationCenter && <OccNotificationBell center={notificationCenter} />}
      <div role="radiogroup" aria-label={copy.language} className={styles.languageSwitch} data-language={language === 'en' ? 'en' : 'es'}
        onKeyDown={event => {
          // Both directions toggle: the switch has exactly two positions.
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const next = language === 'en' ? 'es' : 'en';
          setLanguage(next);
          event.currentTarget.querySelector(`[data-code="${next}"]`)?.focus();
        }}>
        <span className={styles.languageTrack} aria-hidden="true"><span className={styles.languageThumb} /></span>
        {['es', 'en'].map(code => <button key={code} type="button" role="radio" data-code={code} aria-checked={language === code}
          aria-label={t('languageOption.' + code)} tabIndex={language === code ? 0 : -1} onClick={() => setLanguage(code)}>{code.toUpperCase()}</button>)}
      </div>
      <button type="button" className={styles.iconHit} aria-label={theme === 'dark' ? t('themeToLight') : t('themeToDark')} onClick={onToggleTheme}>
        {theme === 'dark' ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}
      </button>
      <div className={styles.anchor}>
        <button ref={profileTrigger} type="button" className={styles.profile} aria-label={copy.account + ': ' + (user?.name ?? '')} aria-haspopup="menu" aria-expanded={menu?.id === 'user'}
          onClick={event => open('user', event)} onKeyDown={triggerKey('user')}>
          <span className={styles.avatar} aria-hidden="true">{initials}</span><span className={styles.userName}>{user?.name}</span>
        </button>
        {menu?.id === 'user' && <div ref={panel} role="menu" aria-label={copy.account} className={styles.accountMenu}>
          <div className={styles.identity}><strong>{user?.name}</strong><span>{user?.role}</span><span>{copy.utc}: {clock}</span></div>
          <button type="button" role="menuitem" className={styles.logout} onClick={() => { onLogout?.({ returnFocusTo: profileTrigger.current }); setMenu(null); }}>{t('logout')}</button>
        </div>}
      </div>
    </div>
  </header>;
}
