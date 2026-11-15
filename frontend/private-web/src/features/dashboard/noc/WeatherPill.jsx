'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import { imageAgeMinutes, loadSatelliteImageInfo, SATELLITE_OPACITY } from '../../../services/satelliteService';
import { loadRecentMetars } from '../../../services/weatherService';
import OccPopover from '../../occ-ui/OccPopover';
import OccSegmented from '../../occ-ui/OccSegmented';
import { formatClock } from '../../occ-ui/occTime';
import { isObservationStale, observationAgeMinutes } from '../../weather/useMdpcWeather';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_SCROLL } from './consoleStyles';
import { describeClouds, describeVisibility, describeWeather, describeWind } from './weatherWords';

// The weather pill of the console (contratos 2.5): today's METAR of MDPC from the browser's IEM service (PR M8 moves it
// to the API), at the end of the provenance line under the map, with the wind, the QNH, the age of the observation and
// «No oficial». It opens its detail, which carries everything the old dashboard's weather panel showed, so nothing is
// lost (design D.1): the decoded and the raw METAR with its times and freshness, the last reports, and the GOES-East and
// IMERG imagery of NASA GIBS on the maps lane's GoesCloudMap, loaded only while the detail is open.

const GoesCloudMap = dynamic(() => import('../../maps/GoesCloudMap'), { ssr: false });

const IMAGERY = Object.freeze(['goes', 'imerg']);
const IMAGE_REFRESH_MS = 10 * 60_000;
const NO_IMAGE = Object.freeze({ status: 'loading', time: null });
const TAG = 'inline-flex shrink-0 items-center rounded-sm border border-occ-line-strong px-1.5 text-xs font-semibold '
  + 'leading-5';
const LABEL = 'text-xs font-medium text-occ-muted';

const utcTime = (iso, locale) => formatClock(iso, locale, 'UTC');

// The device's time, read again every minute: the age of an observation is counted from it, as the old panel did.
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function WindArrow({ directionDeg }) {
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

function Variable({ label, value, note }) {
  return (
    <div className="min-w-0">
      <dt className={LABEL}>{label}</dt>
      <dd className="mt-0.5 text-sm text-occ-text">
        {value}
        {note ? <span className="ml-1 text-xs text-occ-muted">({note})</span> : null}
      </dd>
    </div>
  );
}

function Freshness({ t, locale, weather, now }) {
  const { observedAt } = weather.data;
  const stale = isObservationStale(observedAt, now);
  return (
    <div className="space-y-1 text-xs text-occ-muted">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <time dateTime={observedAt} className="font-mono text-occ-text">{t('weather.observed', { time: utcTime(observedAt, locale) })}</time>
        <span>{t('weather.age', { minutes: observationAgeMinutes(observedAt, now) })}</span>
        {weather.fetchedAt ? <time dateTime={weather.fetchedAt}>{t('weather.received', { time: utcTime(weather.fetchedAt, locale) })}</time> : null}
        {stale ? <span className={`${TAG} text-occ-text`}>{t('weather.stale')}</span> : null}
      </p>
      {weather.refreshing ? <p>{t('weather.refreshing')}</p> : null}
      {stale ? <p className="text-occ-text">{t('weather.staleBody')}</p> : null}
      {weather.refreshFailed ? <p className="text-occ-text">{t('weather.refreshFailed')}</p> : null}
    </div>
  );
}

function Observation({ t, observation }) {
  const { metar, derived } = observation;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      <Variable label={t('weather.temperature')} value={metar.temperatureC != null ? `${metar.temperatureC} °C` : '—'} />
      <Variable label={t('weather.dewPoint')} value={metar.dewPointC != null ? `${metar.dewPointC} °C` : '—'} />
      {derived.feelsLikeC != null
        ? <Variable label={t('weather.feelsLike')} value={`${derived.feelsLikeC} °C`} note={t('weather.derivedNote')} />
        : null}
      {derived.relativeHumidity != null
        ? <Variable label={t('weather.humidity')} value={`${derived.relativeHumidity} %`} note={t('weather.derivedNote')} />
        : null}
      <Variable label={t('weather.wind')} value={describeWind(t, metar.wind)} />
      <Variable label={t('weather.visibility')} value={describeVisibility(t, metar.visibility)} />
      <Variable label={t('weather.clouds')} value={describeClouds(t, metar.clouds)} />
      <Variable label={t('weather.qnh')} value={metar.qnhHpa != null ? `${metar.qnhHpa} hPa` : '—'} />
      <Variable label={t('weather.weatherNow')}
        value={metar.weather.length ? metar.weather.map(item => describeWeather(t, item)).join(', ') : t('weather.noWeather')} />
      {derived.precipitationLastHourIn != null ? (
        <Variable label={t('weather.precipitation')} note={t('weather.derivedNote')}
          value={`${Math.round(derived.precipitationLastHourIn * 25.4 * 10) / 10} mm`} />
      ) : null}
      {metar.trend ? <Variable label={t('weather.trend')} value={<span className="font-mono text-xs">{metar.trend}</span>} /> : null}
    </dl>
  );
}

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
      <h3 className={LABEL}>{t('weather.history')}</h3>
      {body}
    </section>
  );
}

// The time of the satellite image on screen: its instant and age, its day alone, or why there is none.
function ImageTime({ t, locale, image, now }) {
  if (!image.time) return t(image.status === 'loading' ? 'weather.imageChecking' : 'weather.imageUnavailable');
  if (image.precision === 'day') return <time dateTime={image.time}>{t('weather.imageDay', { date: image.time })}</time>;
  const age = imageAgeMinutes(image.time, now);
  return (
    <>
      <time dateTime={image.time}>{t('weather.cloudsTime', { time: utcTime(image.time, locale) })}</time>
      {age != null ? <>{', '}{t('weather.imageAge', { minutes: age })}</> : null}
    </>
  );
}

// The GOES-East and IMERG times of NASA GIBS, read when the detail opens and every 10 minutes while it stays open.
function useSatelliteImages() {
  const [images, setImages] = useState({ goes: NO_IMAGE, imerg: NO_IMAGE });
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      for (const layer of IMAGERY) {
        loadSatelliteImageInfo(layer, { signal: controller.signal })
          .then(info => {
            if (!controller.signal.aborted) setImages(current => ({ ...current, [layer]: info
              ? { status: 'ready', ...info } : { status: 'unavailable', time: null } }));
          })
          .catch(error => {
            if (!controller.signal.aborted && !isAbortError(error)) {
              setImages(current => ({ ...current, [layer]: { status: 'unavailable', time: null } }));
            }
          });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, IMAGE_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      abortForEffectCleanup(controller);
    };
  }, []);
  return images;
}

function Imagery({ t, locale, now, imagery, onImagery }) {
  const images = useSatelliteImages();
  const image = images[imagery];
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <OccSegmented label={t('weather.imageryLayer')} size="sm" value={imagery} onChange={onImagery}
        options={IMAGERY.map(layer => ({ id: layer, label: t(`weather.layer.${layer}`) }))} />
      <div className="relative h-64 min-h-0 overflow-hidden rounded border border-occ-line bg-occ-canvas">
        <GoesCloudMap theme="dark" imagery={image.status === 'ready' ? imagery : 'none'} imageryTime={image.time}
          labels={{ cloudsUnavailable: t('weather.cloudsUnavailable') }} />
      </div>
      <p className="text-xs text-occ-text">
        <ImageTime t={t} locale={locale} image={image} now={now} />
      </p>
      <p className="text-xs text-occ-muted">
        {t(`weather.sourceLayer.${imagery}`)}{'. '}{t(`weather.legend.${imagery}`)}{', '}
        {t('weather.opacity', { percent: Math.round(SATELLITE_OPACITY[imagery] * 100) })}{'.'}
      </p>
      <p className="text-xs text-occ-muted">{t(`weather.hint.${imagery}`)}</p>
    </section>
  );
}

function WeatherDetail({ t, locale, weather, now, imagery, onImagery }) {
  const observation = weather?.data ?? null;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-occ-text">{t('weather.dialogTitle')}</h2>
          <span className={`${TAG} text-occ-muted`}>{t('weather.unofficial')}</span>
        </div>
        {!observation && weather?.status === 'loading' ? <p className="text-sm text-occ-muted">{t('weather.loading')}</p> : null}
        {!observation && weather?.status === 'error' ? (
          <div role="alert" className="space-y-2">
            <p className="text-sm text-occ-text">{t('weather.error')}</p>
            <button type="button" onClick={weather.refresh} className={CONSOLE_ACTION}>{t('weather.retry')}</button>
          </div>
        ) : null}
        {observation ? (
          <>
            <Observation t={t} observation={observation} />
            <div>
              <p className={LABEL}>{t('weather.raw')}</p>
              <p className="mt-1 break-words rounded-sm bg-occ-panel p-2 font-mono text-xs text-occ-text">
                {observation.metar.raw}
              </p>
            </div>
            <Freshness t={t} locale={locale} weather={weather} now={now} />
            <p className="text-xs text-occ-muted">
              <a href={observation.source.url} target="_blank" rel="noreferrer"
                className="underline underline-offset-2 hover:text-occ-text">{t('weather.source')}</a>
            </p>
          </>
        ) : null}
        <History t={t} locale={locale} />
      </div>
      <Imagery t={t} locale={locale} now={now} imagery={imagery} onImagery={onImagery} />
    </div>
  );
}

// What the pill says: the wind, the QNH, the age and «No oficial», or the state of the read.
function PillContent({ t, weather, now }) {
  const observation = weather?.data ?? null;
  if (!observation) {
    return <span>{t(weather?.status === 'error' ? 'weather.error' : 'weather.loading')}</span>;
  }
  const { metar, observedAt } = observation;
  return (
    <>
      <WindArrow directionDeg={metar.wind?.variable ? null : metar.wind?.directionDeg} />
      <span className="whitespace-nowrap">{t('weather.windShort', { wind: describeWind(t, metar.wind) })}</span>
      {metar.qnhHpa != null
        ? <span className="whitespace-nowrap">{t('weather.qnhShort', { value: metar.qnhHpa })}</span>
        : null}
      <span className="whitespace-nowrap text-occ-muted">{t('weather.age', { minutes: observationAgeMinutes(observedAt, now) })}</span>
      {isObservationStale(observedAt, now) ? <span className={`${TAG} text-occ-text`}>{t('weather.stale')}</span> : null}
      <span className={`${TAG} text-occ-muted`}>{t('weather.unofficial')}</span>
    </>
  );
}

/**
 * The pill and its detail. `weather` is useMdpcWeather's view (`status`, `data`, `fetchedAt`, `refreshing`,
 * `refreshFailed`, `refresh`). The detail is a non-modal dialog named «Meteorología · Punta Cana (MDPC)» that opens
 * above the pill and closes with Esc, the pill again or a click outside.
 */
export default function WeatherPill({ weather, className = '' }) {
  const { t, locale } = useTranslation(consoleMessages);
  const now = useNow();
  const [imagery, setImagery] = useState('goes');
  return (
    <OccPopover className={className} align="end" panelLabel={t('weather.dialogTitle')}
      triggerClassName="inline-flex min-h-8 max-w-full items-center gap-2 rounded border border-occ-line px-2 text-xs text-occ-text hover:bg-occ-panel-raised [@media(pointer:coarse)]:min-h-11"
      panelClassName={`!top-auto bottom-full !mt-0 mb-2 w-[min(46rem,calc(100vw_-_2rem))] !max-h-[min(42rem,calc(100dvh_-_8rem))] ${CONSOLE_SCROLL}`}
      trigger={<PillContent t={t} weather={weather} now={now} />}>
      <WeatherDetail t={t} locale={locale} weather={weather} now={now} imagery={imagery} onImagery={setImagery} />
    </OccPopover>
  );
}
