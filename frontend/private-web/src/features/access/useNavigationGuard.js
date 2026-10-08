'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

function matches(item, pathname) {
  return pathname === item.path || pathname?.startsWith(`${item.path}/`);
}

/**
 * Keeps a route-based shell inside the modules the account may open: the base
 * path and any module outside `allowed` redirect to the first allowed module.
 * Returns whether the current route can render.
 */
export function useNavigationGuard(navigation, allowed) {
  const pathname = usePathname();
  const router = useRouter();
  const current = navigation.find(item => matches(item, pathname));
  const permitted = Boolean(current && allowed.some(item => item.id === current.id));
  const fallback = allowed[0]?.path ?? null;

  useEffect(() => {
    if (!permitted && fallback && pathname !== fallback) router.replace(fallback);
  }, [fallback, pathname, permitted, router]);

  return { permitted, empty: allowed.length === 0 };
}
