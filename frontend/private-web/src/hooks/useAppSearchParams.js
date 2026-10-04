'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useAppSearchParams() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const setSearchParams = useCallback((nextValue, options = {}) => {
    const current = new URLSearchParams(searchParams.toString());
    const value = typeof nextValue === 'function' ? nextValue(current) : nextValue;
    const next = new URLSearchParams(value);
    const query = next.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    router[options.replace ? 'replace' : 'push'](target, { scroll: false });
  }, [pathname, router, searchParams]);

  return [searchParams, setSearchParams];
}
