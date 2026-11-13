'use client';

import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import Toast from '../../../components/Toast';
import { useOptionalOccShellToasts } from './occShellContext';

/**
 * What the OCC shell shows above every screen. Mounted by OccTopbar, it portals into the nearest
 * `[data-shell-root]`, never into `main`: `main` remounts on every route (`key={pathname}`) and animates with a
 * transform, which would drop the toasts on navigation and pin their fixed position to `main`. Inside the shell root
 * the toasts keep `data-department="occ"` and the legacy bridge above them. Outside OccShellProvider it renders nothing.
 */
export default function OccShellOverlays() {
  const toasts = useOptionalOccShellToasts();
  const [root, setRoot] = useState(null);
  const anchor = useCallback(node => { if (node) setRoot(node.closest('[data-shell-root]')); }, []);

  if (!toasts) return null;
  return (
    <>
      <span ref={anchor} hidden />
      {root ? createPortal(<Toast toasts={toasts.toasts} onDismiss={toasts.dismissToast} />, root) : null}
    </>
  );
}
