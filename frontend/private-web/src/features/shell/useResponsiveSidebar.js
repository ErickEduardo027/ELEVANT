import { useCallback, useEffect, useState } from 'react';
import { MEDIA_QUERIES } from '../../config/breakpoints';
import { useMediaQuery } from '../../hooks/useMediaQuery';

const STORAGE_KEY = 'elevant-sidebar-expanded';
// Alineados con Tailwind: móvil por debajo de `sm` (640px) y tablet por debajo
// de `lg` (1024px). A 640px exactos ya hay rail; a 1024px ya hay escritorio.
const TABLET_QUERY = MEDIA_QUERIES.belowDesktop;
const MOBILE_QUERY = MEDIA_QUERIES.mobile;

function readStoredExpanded() {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  return stored === null ? true : stored === 'true';
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
