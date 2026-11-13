'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from '../../../i18n/LanguageScope';
import { alertSummary } from '../../dashboard/noc/alertModel';
import OccPlate from '../../occ-ui/OccPlate';
import { MenuIcon } from '../../shell/components/icons';
import { useOccShell, useOptionalOccShellToasts } from './occShellContext';
import { occNavLabel } from './occNavLabel';
import OccShellOverlays from './OccShellOverlays';
import { occShellMessages } from './occShellMessages';
import OccAlertsButton from './status/OccAlertsButton';
import OccClocks from './status/OccClocks';
import OccLanguageToggle from './status/OccLanguageToggle';
import OccLegendButton from './status/OccLegendButton';
import OccLiveIndicator from './status/OccLiveIndicator';
import OccSourcesButton from './status/OccSourcesButton';
import OccUserMenu from './status/OccUserMenu';
import { COARSE_TARGET, STATUS_BAR_LAYOUT as LAYOUT } from './status/statusBarLayout';

const isCurrent = (pathname, item) => pathname === item.path || pathname?.startsWith(`${item.path}/`);

/**
 * The OCC status bar (design C.3), 48 px high on every OCC screen. It answers what time it is, whether the picture is
 * live, whether the sources can be trusted and whether anything needs the controller: the station, the module, the
 * live link, the sources, the alerts, the two clocks, the language, «Leyenda» and the account. The OCC is dark only and
 * has no theme button, so the `theme` and `onToggleTheme` props that AppShell sends to every top bar go unread, as do
 * its notification props: the bar reads the notices of OccShellProvider (useOccShell). Which element shows at which
 * width comes from status/statusBarLayout.js. The alerts open «Alertas y avisos» (OccAlertsDrawer), whose open state
 * lives here and which OccShellOverlays draws in the shell root.
 */
export default function OccTopbar({ navigation = [], user, onOpenMenu, onLogout }) {
  const { t } = useTranslation(occShellMessages);
  const pathname = usePathname();
  const { live, sources, notices } = useOccShell();
  const current = navigation.find(item => isCurrent(pathname, item));
  const summary = useMemo(() => alertSummary(notices.items), [notices.items]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsButton = useRef(null);
  const drawerId = useId();
  // The drawer shows every notice the toasts stand for: opening it takes them away.
  const dismissAllToasts = useOptionalOccShellToasts()?.dismissAllToasts;
  const openAlerts = useCallback(() => {
    setAlertsOpen(true);
    dismissAllToasts?.();
  }, [dismissAllToasts]);
  const closeAlerts = useCallback(() => setAlertsOpen(false), []);
  const alerts = useMemo(() => ({ open: alertsOpen, id: drawerId, onClose: closeAlerts, returnFocusRef: alertsButton }),
    [alertsOpen, closeAlerts, drawerId]);

  // The browser's back and forward buttons leave the screen the drawer was opened on: they close it.
  useEffect(() => {
    if (!alertsOpen) return undefined;
    window.addEventListener('popstate', closeAlerts);
    return () => window.removeEventListener('popstate', closeAlerts);
  }, [alertsOpen, closeAlerts]);

  return (
    <header className="relative z-nav flex h-12 shrink-0 items-center gap-1 border-b border-occ-line bg-occ-panel px-2 sm:gap-1.5 sm:px-3 xl:gap-2 xl:px-4">
      {onOpenMenu && (
        <button type="button" onClick={onOpenMenu} aria-label={t('openMenu')}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded text-occ-text hover:bg-occ-panel-raised ${COARSE_TARGET} ${LAYOUT.menu.bar}`}>
          <MenuIcon className="h-5 w-5" />
        </button>
      )}

      <p className="flex min-w-0 items-center gap-2 text-sm">
        <OccPlate kind="station">PUJ</OccPlate>
        <span className={`shrink-0 text-occ-muted ${LAYOUT.stationCity.bar}`}>{t('stationCity')}</span>
        <span className={`min-w-0 truncate font-semibold text-occ-text ${LAYOUT.module.bar}`}>
          {current ? occNavLabel(t, current) : t('department')}
        </span>
      </p>

      <span aria-hidden="true" className="min-w-0 flex-1" />

      <OccLiveIndicator live={live} className={LAYOUT.live.bar} labelClassName={LAYOUT.live.label} />
      <OccSourcesButton sources={sources} className={LAYOUT.sources.bar} labelClassName={LAYOUT.sources.label} />
      {/* Without the notices permission there is nothing to count, and the notifications page is not open to the
          account either. */}
      {notices.status !== 'forbidden' && (
        <OccAlertsButton ref={alertsButton} summary={summary} status={notices.status} onOpen={openAlerts}
          expanded={alertsOpen} controls={alertsOpen ? drawerId : undefined} className={LAYOUT.alerts.bar}
          labelClassName={LAYOUT.alerts.label} />
      )}
      <OccClocks className={LAYOUT.localClock.bar} utcClassName={LAYOUT.utcClock.bar} />
      <OccLanguageToggle className={LAYOUT.language.bar} />
      <OccLegendButton className={LAYOUT.legend.bar} />
      <OccUserMenu user={user} onLogout={onLogout} className={LAYOUT.account.bar} />
      <OccShellOverlays alerts={alerts} />
    </header>
  );
}
