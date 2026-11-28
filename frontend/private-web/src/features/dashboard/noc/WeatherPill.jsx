'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import { loadRecentMetars } from '../../../services/weatherService';
import OccPopover from '../../occ-ui/OccPopover';
import { observationAgeMinutes } from '../../weather/useMdpcWeather';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_SCROLL } from './consoleStyles';
import {
  Freshness, Observation, useNow, utcTime, WEATHER_LABEL, WEATHER_TAG, weatherIsStale, WindArrow,
} from './WeatherObservation';
import { describeWind, weatherStateKey } from './weatherWords';

// The weather pill of the console (contratos 2.5): the METAR of MDPC that the API relays from NOAA Aviation Weather
// Center (useMdpcWeather), at the end of the provenance line under the map, with the wind, the QNH, the age of the
// observation and «No oficial». It opens its detail: the decoded and the raw METAR with its times and freshness, and the
// last reports. Lane M7 (2026-11-27) retired the detail's own satellite map (GoesCloudMap): the satellite is a layer of
// the one map now. It also says every state without an observation (empty, refused) instead of «Consultando…», counts
// the API's Stale as stale, and credits NOAA AWC. The six hours of reports still come from IEM (loadRecentMetars, the
// last Mesonet reader, read only while the detail is open) until the API relays them.

// The last reports of MDPC, read once each time the detail opens.
function History({ t, locale }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => {
    const controller = new AbortController();
    loadRecentMetars({ hours: 6, signal: controller.signal })
      .then(items => { if (!controller.signal.aborted) setState({ status: 'success', items }); })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setState({ status: 'error', items: [] });
      });
    return () => abortForEffectCleanup(controller);
  }, []);
  let body;
  if (state.status === 'loading') body = <p className="text-xs text-occ-muted">{t('weather.loading')}</p>;
  else if (state.status === 'error') body = <p className="text-xs text-occ-text">{t('weather.historyError')}</p>;
  else if (!state.items.length) body = <p className="text-xs text-occ-muted">{t('weather.historyEmpty')}</p>;
  else {
    body = (
      <ul className="divide-y divide-occ-line">
        {state.items.map(item => (
          <li key={item.observedAt} className="py-1.5">
            <time dateTime={item.observedAt} className="font-mono text-xs font-semibold text-occ-text">
              {utcTime(item.observedAt, locale)} UTC
            </time>
            <p className="mt-0.5 break-words font-mono text-xs text-occ-muted">{item.metar.raw}</p>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="space-y-1">
      <h3 className={WEATHER_LABEL}>{t('weather.history')}</h3>
      {body}
    </section>
  );
}

/** The credit of the weather, a link to its home: NOAA Aviation Weather Center. */
export function WeatherCredit({ t, source, messageKey = 'weather.source' }) {
  const url = source?.url ?? source?.homeUrl ?? null;
  return (
    <p className="text-xs text-occ-muted">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-occ-text">
          {t(messageKey)}
        </a>
      ) : t(messageKey)}
    </p>
  );
}

/** What a weather surface says while it has no observation, with a retry after a failed read. */
export function WeatherState({ t, weather }) {
  const key = weatherStateKey(weather);
  if (key === null) return null;
  if (key === 'weather.error') {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-sm text-occ-text">{t(key)}</p>
        {weather?.refresh ? <button type="button" onClick={weather.refresh} className={CONSOLE_ACTION}>{t('weather.retry')}</button> : null}
      </div>
    );
  }
  return <p className={`text-sm ${key === 'weather.loading' ? 'text-occ-muted' : 'text-occ-text'}`}>{t(key)}</p>;
}

function WeatherDetail({ t, locale, weather, now }) {
  const observation = weather?.data ?? null;
  const source = observation?.source ?? weather?.source ?? null;
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-occ-text">{t('weather.dialogTitle')}</h2>
        <span className={`${WEATHER_TAG} text-occ-muted`}>{t('weather.unofficial')}</span>
      </div>
      <WeatherState t={t} weather={weather} />
      {observation ? (
        <>
          <Observation t={t} observation={observation} />
          <div>
            <p className={WEATHER_LABEL}>{t('weather.raw')}</p>
            <p className="mt-1 break-words rounded-sm bg-occ-panel p-2 font-mono text-xs text-occ-text">
              {observation.metar.raw}
            </p>
          </div>
          <Freshness t={t} locale={locale} weather={weather} now={now} />
        </>
      ) : null}
      {source ? <WeatherCredit t={t} source={source} /> : null}
      <History t={t} locale={locale} />
    </div>
  );
}

// What the pill says: the wind, the QNH, the age and «No oficial», or the state of the read.
function PillContent({ t, weather, now }) {
  const observation = weather?.data ?? null;
  if (!observation) return <span>{t(weatherStateKey(weather))}</span>;
  const { metar, observedAt } = observation;
  return (
    <>
      <WindArrow directionDeg={metar.wind?.variable ? null : metar.wind?.directionDeg} />
      <span className="whitespace-nowrap">{t('weather.windShort', { wind: describeWind(t, metar.wind) })}</span>
      {metar.qnhHpa != null
        ? <span className="whitespace-nowrap">{t('weather.qnhShort', { value: metar.qnhHpa })}</span>
        : null}
      <span className="whitespace-nowrap text-occ-muted">{t('weather.age', { minutes: observationAgeMinutes(observedAt, now) })}</span>
      {weatherIsStale(weather, now) ? <span className={`${WEATHER_TAG} text-occ-text`}>{t('weather.stale')}</span> : null}
      <span className={`${WEATHER_TAG} text-occ-muted`}>{t('weather.unofficial')}</span>
    </>
  );
}

/**
 * The pill and its detail. `weather` is useMdpcWeather's view (`status`, `data`, `apiStatus`, `source`, `fetchedAt`,
 * `refreshing`, `refreshFailed`, `refresh`). The detail is a non-modal dialog named «Meteorología · Punta Cana (MDPC)»
 * that opens above the pill and closes with Esc, the pill again or a click outside.
 */
export default function WeatherPill({ weather, className = '' }) {
  const { t, locale } = useTranslation(consoleMessages);
  const now = useNow();
  return (
    <OccPopover className={className} align="end" panelLabel={t('weather.dialogTitle')}
      triggerClassName="inline-flex min-h-8 max-w-full items-center gap-2 rounded border border-occ-line px-2 text-xs text-occ-text hover:bg-occ-panel-raised [@media(pointer:coarse)]:min-h-11"
      panelClassName={`!top-auto bottom-full !mt-0 mb-2 w-[min(30rem,calc(100vw_-_2rem))] !max-h-[min(42rem,calc(100dvh_-_8rem))] ${CONSOLE_SCROLL}`}
      trigger={<PillContent t={t} weather={weather} now={now} />}>
      <WeatherDetail t={t} locale={locale} weather={weather} now={now} />
    </OccPopover>
  );
}
