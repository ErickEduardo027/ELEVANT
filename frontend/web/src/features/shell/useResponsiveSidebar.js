import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'elevant-sidebar-expanded';
const TABLET_QUERY = '(max-width: 1024px)';
const MOBILE_QUERY = '(max-width: 640px)';

function matches(query) {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
}

function readStoredExpanded() {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  return stored === null ? true : stored === 'true';
}

function useMediaQuery(query) {
  const [matched, setMatched] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const onChange = event => setMatched(event.matches);
    mql.addEventListener('change', onChange);
    setMatched(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matched;
}

// Drives the three responsive sidebar behaviors: on desktop the inline rail
// itself expands/collapses (persisted); on tablet the rail stays icon-only
// and the toggle opens a full flyout overlay instead; on mobile there is no
// inline rail at all, only the overlay (opened from the Topbar's menu button).
export function useResponsiveSidebar() {
  const isTablet = useMediaQuery(TABLET_QUERY);
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [desktopExpanded, setDesktopExpanded] = useState(readStoredExpanded);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    window.localStorage?.setItem(STORAGE_KEY, String(desktopExpanded));
  }, [desktopExpanded]);

  const breakpoint = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  useEffect(() => {
    setOverlayOpen(false);
  }, [breakpoint]);

  const railVisible = breakpoint !== 'mobile';
  const railExpanded = breakpoint === 'desktop' && desktopExpanded;

  const toggle = useCallback(() => {
    if (breakpoint === 'desktop') {
      setDesktopExpanded(value => !value);
    } else {
      setOverlayOpen(value => !value);
    }
  }, [breakpoint]);

  const closeOverlay = useCallback(() => setOverlayOpen(false), []);

  return { breakpoint, railVisible, railExpanded, overlayOpen, toggle, closeOverlay };
}
