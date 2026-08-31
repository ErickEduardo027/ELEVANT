import { useEffect, useState } from 'react';

// Matches TABLET_QUERY in src/features/shell/useResponsiveSidebar.js — same
// breakpoint the Sidebar itself switches to its tablet/overlay behavior at.
const TABLET_QUERY = '(max-width: 1024px)';

function matchesTablet() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(TABLET_QUERY).matches);
}

export function useIsTabletBreakpoint() {
  const [isTablet, setIsTablet] = useState(matchesTablet);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(TABLET_QUERY);
    const onChange = event => setIsTablet(event.matches);
    mql.addEventListener('change', onChange);
    setIsTablet(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isTablet;
}
