'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

function matches(item, pathname) {
  return pathname === item.path || pathname?.startsWith(`${item.path}/`);
}

/**
 * Keeps a route-based shell inside the modules the account may open. The department entry (`basePath`) opens
 * `homePath` when the account may open it; otherwise, like any module outside `allowed`, it redirects to the first
 * allowed module. An account without modules stays where it is (`empty`) so the shell can show NoModulesNotice.
 * Returns whether the current route can render.
 */
export function useNavigationGuard(navigation, allowed, { homePath, basePath } = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = navigation.find(item => matches(item, pathname));
  const permitted = Boolean(current && allowed.some(item => item.id === current.id));
  const homeAllowed = Boolean(homePath && allowed.some(item => item.path === homePath));
  const fallback = pathname === basePath && homeAllowed ? homePath : allowed[0]?.path ?? null;

  useEffect(() => {
    if (!permitted && fallback && pathname !== fallback) router.replace(fallback);
  }, [fallback, pathname, permitted, router]);

  return { permitted, empty: allowed.length === 0 };
}
