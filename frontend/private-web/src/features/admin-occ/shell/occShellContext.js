'use client';

import { createContext, useContext } from 'react';

// The two contexts of the OCC shell (OccShellProvider.jsx). They live apart from the provider so that
// live/useOccResource.js, which the provider itself uses, imports them without an import cycle.

/** The public value: `{ live, subscribe, notices, sources }`. It changes with the live link, the notices and the sources. */
export const OccShellContext = createContext(null);

/**
 * The stable part, `{ subscribe, sources: { report, remove } }`, created once per tab. Readers that only subscribe or
 * report (every useOccResource) take it from here and do not re-render when the live link or the notices move.
 */
export const OccShellChannelContext = createContext(null);

/**
 * Shown on screen through OccShellOverlays: `{ toasts, dismissToast(id), dismissAllToasts() }`, the visible toasts of
 * shell/occToastQueue.js, each `{ id, priority, message, code, action: { label, path } }`.
 */
export const OccShellToastContext = createContext(null);

export function useOccShell() {
  const value = useContext(OccShellContext);
  if (!value) throw new Error('useOccShell must be used inside OccShellProvider');
  return value;
}

/** The shell's value when the OCC frame is mounted; null in isolated screens and tests. */
export function useOptionalOccShell() {
  return useContext(OccShellContext);
}

export function useOccShellChannel() {
  const value = useContext(OccShellChannelContext);
  if (!value) throw new Error('useOccResource must be used inside OccShellProvider');
  return value;
}

export function useOptionalOccShellChannel() {
  return useContext(OccShellChannelContext);
}

export function useOptionalOccShellToasts() {
  return useContext(OccShellToastContext);
}
