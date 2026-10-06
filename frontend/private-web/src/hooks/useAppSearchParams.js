'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useAppSearchParams() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const query = searchParams.toString();
  const navigation = useRef({ pathname, observed: query, draft: query, pending: [] });

  useLayoutEffect(() => {
    const state = navigation.current;
    if (state.pathname !== pathname) {
      navigation.current = { pathname, observed: query, draft: query, pending: [] };
      return;
    }
    if (state.observed === query) return;

    state.observed = query;
    const settled = state.pending.indexOf(query);
    if (settled === -1) {
      // A back/forward or other external navigation supersedes local edits.
      state.pending = [];
      state.draft = query;
    } else {
      // An earlier navigation may settle while a newer edit is still pending.
      state.pending.splice(0, settled + 1);
      if (state.pending.length === 0) state.draft = query;
    }
  }, [pathname, query]);

  const setSearchParams = useCallback((nextValue, options = {}) => {
    const current = new URLSearchParams(navigation.current.draft);
    const value = typeof nextValue === 'function' ? nextValue(current) : nextValue;
    const next = new URLSearchParams(value);
    const nextQuery = next.toString();
    navigation.current.draft = nextQuery;
    navigation.current.pending.push(nextQuery);
    const target = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    router[options.replace ? 'replace' : 'push'](target, { scroll: false });
  }, [pathname, router]);

  return [searchParams, setSearchParams];
}
