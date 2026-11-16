import { useMemo, useState } from 'react';
import { createSourceHealthStore, summarizeSources } from '../../live/sourceHealth';
import { OccShellChannelContext, OccShellContext, OccShellToastContext } from '../occShellContext';

// Test-only stand-ins for OccShellProvider. Synthetic values: no observer, no request.

export const OCC_TEST_ACCOUNT_ID = '30000000-0000-4000-8000-000000000001';

const NO_TOASTS = Object.freeze({ toasts: Object.freeze([]), dismissToast: () => {}, dismissAllToasts: () => {} });

/**
 * A shell value with a working `subscribe`, plus three test helpers: `announce(resources)` delivers an
 * announcement to the subscribers of those resources, `subscriptions()` lists the resources someone listens to, and
 * `sourceStore` is the store behind `sources.report` and `sources.remove`.
 */
export function createOccShellValue({ live, notices, sources, ...rest } = {}) {
  const channels = new Map();
  const subscribe = (resources, onChange) => {
    const entry = { onChange };
    const keys = [...new Set(resources)];
    for (const key of keys) {
      if (!channels.has(key)) channels.set(key, new Set());
      channels.get(key).add(entry);
    }
    return () => { for (const key of keys) channels.get(key)?.delete(entry); };
  };
  const announce = resources => {
    const due = new Set(resources.flatMap(resource => [...(channels.get(resource) ?? [])]));
    for (const entry of due) entry.onChange(resources.filter(resource => channels.get(resource)?.has(entry)));
  };
  const subscriptions = () => [...channels.entries()].filter(([, entries]) => entries.size > 0).map(([key]) => key).sort();
  const sourceStore = createSourceHealthStore();
  return {
    live: { state: 'live', since: 0, lastOkAt: 0, ...live },
    subscribe,
    notices: {
      status: 'success', items: [], hasMore: false, unreadCount: 0, fetchedAt: null, refreshFailed: false,
      refresh: () => {}, retry: () => {}, markRead: async id => ({ id }), ...notices,
    },
    sources: { items: [], summary: summarizeSources([]), report: sourceStore.report, remove: sourceStore.remove, ...sources },
    announce, subscriptions, sourceStore,
    ...rest,
  };
}

/** Provides `value` (or a fresh createOccShellValue()) to useOccShell, useOccResource and OccShellOverlays. */
export function OccShellTestProvider({ value, toasts = NO_TOASTS, children }) {
  const [fallback] = useState(createOccShellValue);
  const shell = value ?? fallback;
  const channel = useMemo(() => ({
    subscribe: shell.subscribe, sources: { report: shell.sources.report, remove: shell.sources.remove },
  }), [shell]);
  return (
    <OccShellChannelContext.Provider value={channel}>
      <OccShellContext.Provider value={shell}>
        <OccShellToastContext.Provider value={toasts}>{children}</OccShellToastContext.Provider>
      </OccShellContext.Provider>
    </OccShellChannelContext.Provider>
  );
}
