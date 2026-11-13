'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import OccToastStack, { OccToastAnnouncer } from '../../occ-ui/OccToastStack';
import OccAlertsDrawer from './OccAlertsDrawer';
import { useOptionalOccShellToasts } from './occShellContext';

const NO_TOASTS = Object.freeze([]);

/**
 * What the OCC shell shows above every screen: the toasts (occ-ui/OccToastStack, fed by OccShellProvider's queue) and
 * «Alertas y avisos» (OccAlertsDrawer) while `alerts.open`. Mounted by OccTopbar, it portals into the nearest
 * `[data-shell-root]`, never into `main`: `main` remounts on every route (`key={pathname}`) and animates with a
 * transform, which would drop the overlays on navigation and pin their fixed position to `main`. Inside the shell root
 * they keep `data-department="occ"` and the legacy bridge above them. Outside OccShellProvider it renders nothing.
 *
 * `alerts` is `{ open, id, onClose, returnFocusRef }`, the drawer's state, which OccTopbar keeps. While the drawer is
 * open no toast is drawn over it: everything a toast would say is in the drawer, and the stack would cover its first
 * rows. The toasts that arrive meanwhile are read out inside it instead (OccToastAnnouncer: an urgent one as an alert),
 * because a modal drawer hides from assistive technology everything outside it. Opening and closing the drawer both
 * clear the queue (OccTopbar), so no toast shows after it with its time cut short.
 */
export default function OccShellOverlays({ alerts = null }) {
  const toasts = useOptionalOccShellToasts();
  const router = useRouter();
  const [root, setRoot] = useState(null);
  const anchor = useCallback(node => { if (node) setRoot(node.closest('[data-shell-root]')); }, []);
  const items = useMemo(() => (toasts?.toasts ?? NO_TOASTS).map(toast => ({
    id: toast.id,
    priority: toast.priority,
    message: toast.message,
    code: toast.code ?? null,
    action: toast.action ? { label: toast.action.label, onClick: () => router.push(toast.action.path) } : null,
  })), [router, toasts]);

  if (!toasts) return null;
  const drawerOpen = Boolean(alerts?.open);
  return (
    <>
      <span ref={anchor} hidden />
      {root ? createPortal(
        drawerOpen ? (
          <OccAlertsDrawer id={alerts.id} onClose={alerts.onClose} returnFocusRef={alerts.returnFocusRef}>
            <OccToastAnnouncer toasts={items} />
          </OccAlertsDrawer>
        ) : <OccToastStack toasts={items} onDismiss={toasts.dismissToast} />,
        root,
      ) : null}
    </>
  );
}
