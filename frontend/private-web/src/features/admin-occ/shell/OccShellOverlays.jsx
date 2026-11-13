'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import OccToastStack from '../../occ-ui/OccToastStack';
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
 * `alerts` is `{ open, id, onClose, returnFocusRef }`, the drawer's state, which OccTopbar keeps (opening it clears the
 * toasts). While the drawer is open no toast is drawn over it: everything a toast would say is in the drawer, whose
 * count announces what arrives, and the stack would cover its first rows.
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
        drawerOpen
          ? <OccAlertsDrawer id={alerts.id} onClose={alerts.onClose} returnFocusRef={alerts.returnFocusRef} />
          : <OccToastStack toasts={items} onDismiss={toasts.dismissToast} />,
        root,
      ) : null}
    </>
  );
}
