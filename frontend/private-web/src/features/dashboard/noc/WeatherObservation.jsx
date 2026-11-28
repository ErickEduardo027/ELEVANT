'use client';

import { useEffect, useState } from 'react';
import { formatClock } from '../../occ-ui/occTime';
import { isObservationStale, observationAgeMinutes, STALE_AFTER_MINUTES } from '../../weather/useMdpcWeather';
import { describeClouds, describeVisibility, describeWeather, describeWind } from './weatherWords';

// The parts of the aerodrome weather that the console's pill (WeatherPill.jsx) and its floating panel «Meteorología
// PUJ» (WeatherPanel.jsx) both draw (lane M7, 2026-11-27): the decoded METAR, its freshness and the wind arrow. `t`
// translates consoleMessages; `weather` is useMdpcWeather's view.

export const WEATHER_TAG = 'inline-flex shrink-0 items-center rounded-sm border border-occ-line-strong px-1.5 text-xs '
  + 'font-semibold leading-5';
export const WEATHER_LABEL = 'text-xs font-medium text-occ-muted';

export const utcTime = (iso, locale) => formatClock(iso, locale, 'UTC');

/** The device's time, read again every minute: the age of an observation is counted from it, as the old panel did. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Whether the observation of `weather` is no longer current at `now`: its age, and the API's Stale first. */
export const weatherIsStale = (weather, now) => isObservationStale(weather?.data?.observedAt, now, weather?.apiStatus ?? null);

export function WindArrow({ directionDeg }) {
  if (directionDeg == null) return null;
  // The arrow points where the wind blows to: the reported direction plus 180°.
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="h-4 w-4 shrink-0 text-occ-muted"
      style={{ transform: `rotate(${(directionDeg + 180) % 360}deg)` }}>
      <path d="M12 3v16M6 13l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        strokeLinejoin="round" />
    </svg>
  );
}

function Variable({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className={WEATHER_LABEL}>{label}</dt>
      <dd className="mt-0.5 text-sm text-occ-text">{value}</dd>
    </div>
  );
}

/** The decoded METAR: temperature, dew point, wind, visibility, clouds, QNH, present weather and trend. */
export function Observation({ t, observation }) {
  const { metar } = observation;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      <Variable label={t('weather.temperature')} value={metar.temperatureC != null ? `${metar.temperatureC} °C` : '—'} />
      <Variable label={t('weather.dewPoint')} value={metar.dewPointC != null ? `${metar.dewPointC} °C` : '—'} />
      <Variable label={t('weather.wind')} value={describeWind(t, metar.wind)} />
      <Variable label={t('weather.visibility')} value={describeVisibility(t, metar.visibility)} />
      <Variable label={t('weather.clouds')} value={describeClouds(t, metar.clouds)} />
      <Variable label={t('weather.qnh')} value={metar.qnhHpa != null ? `${metar.qnhHpa} hPa` : '—'} />
      <Variable label={t('weather.weatherNow')}
        value={metar.weather.length ? metar.weather.map(item => describeWeather(t, item)).join(', ') : t('weather.noWeather')} />
      {metar.trend ? <Variable label={t('weather.trend')} value={<span className="font-mono text-xs">{metar.trend}</span>} /> : null}
    </dl>
  );
}

/**
 * When the METAR was observed and received, its age, and whether it is stale: past STALE_AFTER_MINUTES (90) or kept by
 * the API after a failure (`apiStatus` Stale), whatever its age.
 */
export function Freshness({ t, locale, weather, now }) {
  const { observedAt } = weather.data;
  const stale = weatherIsStale(weather, now);
  return (
    <div className="space-y-1 text-xs text-occ-muted">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <time dateTime={observedAt} className="font-mono text-occ-text">{t('weather.observed', { time: utcTime(observedAt, locale) })}</time>
        <span>{t('weather.age', { minutes: observationAgeMinutes(observedAt, now) })}</span>
        {weather.fetchedAt ? <time dateTime={weather.fetchedAt}>{t('weather.received', { time: utcTime(weather.fetchedAt, locale) })}</time> : null}
        {stale ? <span className={`${WEATHER_TAG} text-occ-text`}>{t('weather.stale')}</span> : null}
      </p>
      {weather.refreshing ? <p>{t('weather.refreshing')}</p> : null}
      {stale ? <p className="text-occ-text">{t('weather.staleBody', { minutes: STALE_AFTER_MINUTES })}</p> : null}
      {weather.refreshFailed ? <p className="text-occ-text">{t('weather.refreshFailed')}</p> : null}
    </div>
  );
}
