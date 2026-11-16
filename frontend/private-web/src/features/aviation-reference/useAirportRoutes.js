'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../i18n/LanguageScope';
import { ROUTES_SOURCE, routeFeatures } from '../maps/style/routeLayers';
import { useAviationReferenceRead, useAviationReferenceService } from './AviationReferenceContext';

// The daily routes from the station's airport for «Rutas desde Punta Cana» (ADR-0043, note of 15 November 2026): read
// when the console opens and again every hour while the tab is visible. The API keeps them 24 hours, so a day of
// Panorama spends one call. The answer becomes the data of the routes source for OccMap's `overlayData`.

/** The pace of the routes: hourly, the API's cache makes most of them free. */
export const AIRPORT_ROUTES_POLL_MS = 3_600_000;

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: Object.freeze([]) });

export function useAirportRoutes(stationId) {
  const service = useAviationReferenceService();
  const { language, locale } = useLanguage();
  const [tick, setTick] = useState(0);
  const active = service !== null && Boolean(stationId);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick(value => value + 1);
    }, AIRPORT_ROUTES_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active]);
  const read = useAviationReferenceRead(active ? `${stationId}|${tick}` : null,
    ({ signal }) => service.getRoutes({ stationId, signal }), { keep: true });
  const routes = read.data?.routes ?? null;
  const overlayData = useMemo(() => ({
    [ROUTES_SOURCE]: routes ? routeFeatures(routes, { locale, perDay: language === 'en' ? '/day' : '/día' }) : EMPTY,
  }), [routes, locale, language]);
  return { active, read, overlayData };
}
