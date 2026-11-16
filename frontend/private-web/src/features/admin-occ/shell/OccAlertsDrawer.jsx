'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { buildAlertQueue } from '../../dashboard/noc/alertModel';
import { notificationTargetPath } from '../../notifications/notificationKinds';
import OccAlertQueue from '../../occ-ui/OccAlertQueue';
import OccDrawer from '../../occ-ui/OccDrawer';
import { ADMIN_OCC_BASE_PATH } from '../navigation';
import { useOccShell } from './occShellContext';
import { occShellMessages } from './occShellMessages';
import { STATION_TIME_ZONE } from './status/OccClocks';

const NOTIFICATIONS_PATH = `${ADMIN_OCC_BASE_PATH}/notifications`;

const HISTORY_LINK = 'inline-flex min-h-8 items-center rounded text-sm font-semibold text-occ-accent underline-offset-4 '
  + 'hover:underline [@media(pointer:coarse)]:min-h-11';

/**
 * «Alertas y avisos» (design C.5), opened from the status bar's alerts: the queue of the notices the shell already read
 * (no read of its own). «Recibido» is the account's read receipt on the server (notices.markRead, PUT
 * notifications/{id}/read), so the count is the same on every screen and after a reload; «Abrir» goes where the notice
 * points and closes the drawer, like «Ver historial de avisos». Times are the station's. `children` go in the drawer
 * after the queue: OccShellOverlays puts there the toasts that arrive while it is open, read out.
 */
export default function OccAlertsDrawer({ id, open = true, onClose, returnFocusRef, children }) {
  const { t, locale } = useTranslation(occShellMessages);
  const router = useRouter();
  const { notices } = useOccShell();
  const { markRead, retry } = notices;
  const queue = useMemo(() => buildAlertQueue(notices.items), [notices.items]);

  const acknowledge = useCallback(entry => markRead(entry.id), [markRead]);
  const openNotice = useCallback(entry => {
    onClose?.();
    router.push(notificationTargetPath(entry.notice));
  }, [onClose, router]);

  return (
    <OccDrawer id={id} open={open} onClose={onClose} title={t('alertsDrawer.title')} returnFocusRef={returnFocusRef}
      footer={<Link href={NOTIFICATIONS_PATH} onClick={onClose} className={HISTORY_LINK}>{t('alertsDrawer.history')}</Link>}>
      <OccAlertQueue alerts={queue.alerts} recent={queue.recent} status={notices.status} onAcknowledge={acknowledge}
        onOpen={openNotice} onRetry={retry} locale={locale} timeZone={STATION_TIME_ZONE}
        staleSince={notices.refreshFailed ? notices.fetchedAt : null} />
      {children}
    </OccDrawer>
  );
}
