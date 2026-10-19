import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { loadRecentMetars } from '../../../services/weatherService';
import { imageAgeMinutes, loadSatelliteImageInfo, SATELLITE_OPACITY } from '../../../services/satelliteService';
import { isObservationStale, observationAgeMinutes } from '../../weather/useMdpcWeather';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import ConsolePanel from './ConsolePanel';
import MapExpandDialog, { ExpandButton } from './MapExpandDialog';
import { formatTime } from './format';

const GoesCloudMap = dynamic(() => import('../../maps/GoesCloudMap'), { ssr: false });

function utcTime(iso, locale) {
  return formatTime(iso, locale, 'UTC');
}

export function describeWeather(t, item) {
  const parts = [];
  if (item.intensity) parts.push(t(`weather.intensity.${item.intensity}`));
  if (item.descriptor) parts.push(t(`weather.descriptor.${item.descriptor}`));
  item.phenomena.forEach(code => parts.push(t(`weather.phenomena.${code}`)));
  return parts.join(' ');
}

function describeClouds(t, clouds) {
  if (!clouds.length) return t('weather.noClouds');
  return clouds.map(layer => {
    const cover = t(`weather.cover.${layer.cover}`);
    const base = layer.baseFt != null ? ` ${layer.baseFt.toLocaleString('en-US')} ft` : '';
    return `${cover}${base}${layer.convective ? ` ${layer.convective}` : ''}`;
  }).join(' · ');
}

function describeVisibility(t, visibility) {
  if (!visibility) return '—';
  const km = visibility.meters / 1000;
  const value = km >= 5 ? Math.round(km) : Math.round(km * 10) / 10;
  return visibility.orMore ? t('weather.visibilityOrMore', { km: value }) : `${value} km`;
}

function WindArrow({ directionDeg }) {
  if (directionDeg == null) return null;
  // La flecha apunta hacia donde sopla el viento (dirección reportada + 180°).
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0 text-occ-accent"
      style={{ transform: `rotate(${(directionDeg + 180) % 360}deg)` }}>
      <path d="M12 3v16M6 13l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function describeWind(t, wind) {
  if (!wind) return '—';
  if (wind.speedKt === 0) return t('weather.windCalm');
  const direction = wind.variable ? t('weather.windVariable') : `${String(wind.directionDeg).padStart(3, '0')}°`;
  const extras = [
    wind.gustKt ? t('weather.gust', { speed: wind.gustKt }) : null,
    wind.variableFrom != null ? t('weather.variableSector', { from: wind.variableFrom, to: wind.variableTo }) : null,
  ].filter(Boolean);
  return `${direction} · ${wind.speedKt} kt${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
}

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function Freshness({ t, locale, observedAt, fetchedAt, now, refreshFailed, refreshing }) {
  const stale = isObservationStale(observedAt, now);
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-occ-muted">
        <time dateTime={observedAt} className="font-mono text-occ-text">{t('weather.observed', { time: utcTime(observedAt, locale) })}</time>
        <span>{t('weather.age', { minutes: observationAgeMinutes(observedAt, now) })}</span>
        {fetchedAt && <time dateTime={fetchedAt}>{t('weather.received', { time: utcTime(fetchedAt, locale) })}</time>}
        {stale && <span className="rounded border border-occ-line-strong px-1.5 font-semibold text-occ-warn">{t('weather.stale')}</span>}
      </p>
      {refreshing && <p className="text-[11px] text-occ-muted">{t('weather.refreshing')}</p>}
      {stale && <p className="text-[11px] text-occ-warn">{t('weather.staleBody')}</p>}
      {refreshFailed && <p className="text-[11px] text-occ-warn">{t('weather.refreshFailed')}</p>}
    </div>
  );
}

function Variable({ label, value, note }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-occ-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-occ-text">{value}{note && <span className="ml-1 text-[10.5px] text-occ-muted">({note})</span>}</dd>
    </div>
  );
}

function ObservationDetails({ t, observation }) {
  const { metar, derived } = observation;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      <Variable label={t('weather.temperature')} value={metar.temperatureC != null ? `${metar.temperatureC} °C` : '—'} />
      <Variable label={t('weather.dewPoint')} value={metar.dewPointC != null ? `${metar.dewPointC} °C` : '—'} />
      {derived.feelsLikeC != null && <Variable label={t('weather.feelsLike')} value={`${derived.feelsLikeC} °C`} note={t('weather.derivedNote')} />}
      {derived.relativeHumidity != null && <Variable label={t('weather.humidity')} value={`${derived.relativeHumidity} %`} note={t('weather.derivedNote')} />}
      <Variable label={t('weather.wind')} value={describeWind(t, metar.wind)} />
      <Variable label={t('weather.visibility')} value={describeVisibility(t, metar.visibility)} />
      <Variable label={t('weather.clouds')} value={describeClouds(t, metar.clouds)} />
      <Variable label={t('weather.qnh')} value={metar.qnhHpa != null ? `${metar.qnhHpa} hPa` : '—'} />
      <Variable label={t('weather.weatherNow')}
        value={metar.weather.length ? metar.weather.map(item => describeWeather(t, item)).join(', ') : t('weather.noWeather')} />
      {derived.precipitationLastHourIn != null && (
        <Variable label={t('weather.precipitation')} value={`${Math.round(derived.precipitationLastHourIn * 25.4 * 10) / 10} mm`} note={t('weather.derivedNote')} />
      )}
      {metar.trend && <Variable label={t('weather.trend')} value={<span className="font-mono text-xs">{metar.trend}</span>} />}
    </dl>
  );
}

function History({ t, locale }) {
  const [state, setState] = useState({ status: 'loading', items: [] });
  useEffect(() => {
    const controller = new AbortController();
    loadRecentMetars({ hours: 6, signal: controller.signal })
      .then(items => { if (!controller.signal.aborted) setState({ status: 'success', items }); })
      .catch(error => { if (!controller.signal.aborted && !isAbortError(error)) setState({ status: 'error', items: [] }); });
    return () => abortForEffectCleanup(controller);
  }, []);
  if (state.status === 'loading') return <p className="px-4 py-3 text-xs text-occ-muted">{t('weather.loading')}</p>;
  if (state.status === 'error') return <p className="px-4 py-3 text-xs text-occ-warn">{t('weather.historyError')}</p>;
  if (!state.items.length) return <p className="px-4 py-3 text-xs text-occ-muted">{t('weather.historyEmpty')}</p>;
  return (
    <ul className="divide-y divide-occ-line">
      {state.items.map(item => (
        <li key={item.observedAt} className="px-4 py-2">
          <time dateTime={item.observedAt} className="font-mono text-[11px] font-semibold text-occ-text">{utcTime(item.observedAt, locale)} UTC</time>
          <p className="mt-0.5 break-words font-mono text-[11px] text-occ-muted">{item.metar.raw}</p>
        </li>
      ))}
    </ul>
  );
}

function ImageryChoices({ t, imagery, onChange }) {
  return (
    <div role="group" aria-label={t('weather.imageryLayer')} className="inline-flex items-center gap-1 rounded-lg border border-occ-line bg-occ-panel p-1">
      {['goes', 'imerg'].map(layer => <button key={layer} type="button" aria-pressed={imagery === layer}
        onClick={() => onChange(layer)}
        className={`min-h-8 rounded-md px-2.5 text-[11px] font-semibold ${imagery === layer ? 'bg-occ-accent-soft text-occ-accent' : 'text-occ-muted hover:text-occ-text'}`}>
        {t(`weather.layer.${layer}`)}
      </button>)}
    </div>
  );
}

function ImageTimestamp({ t, locale, image, now }) {
  if (!image.time) return t(image.status === 'loading' ? 'weather.imageChecking' : 'weather.imageUnavailable');
  if (image.precision === 'day') return <time dateTime={image.time}>{t('weather.imageDay', { date: image.time })}</time>;
  const age = imageAgeMinutes(image.time, now);
  return <><time dateTime={image.time}>{t('weather.cloudsTime', { time: utcTime(image.time, locale) })}</time>
    {age != null && <> · {t('weather.imageAge', { minutes: age })}</>}</>;
}

function ExpandedWeather({ t, locale, theme, weather, now, onClose, image, imagery, setImagery }) {
  const activeImage = image[imagery];
  return (
    <MapExpandDialog title={t('weather.dialogTitle')} note={t(`weather.hint.${imagery}`)}
      closeLabel={t('weather.close')} onClose={onClose}
      actions={<ImageryChoices t={t} imagery={imagery} onChange={setImagery} />}
      aside={<>
        {weather.data && <div className="space-y-4 border-b border-occ-line p-4">
          <ObservationDetails t={t} observation={weather.data} />
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-occ-muted">{t('weather.raw')}</p>
            <p className="mt-1 break-words rounded-md bg-occ-panel-muted p-2 font-mono text-xs text-occ-text">{weather.data.metar.raw}</p>
          </div>
          <Freshness t={t} locale={locale} observedAt={weather.data.observedAt} fetchedAt={weather.fetchedAt}
            now={now} refreshFailed={weather.refreshFailed} refreshing={weather.refreshing} />
          <p className="text-[10.5px] text-occ-muted">
            <a href={weather.data.source.url} target="_blank" rel="noreferrer" className="underline">{t('weather.source')}</a>
          </p>
        </div>}
        <p className="sticky top-0 border-b border-occ-line bg-occ-panel px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-occ-muted">{t('weather.history')}</p>
        <History t={t} locale={locale} />
      </>}>
      <GoesCloudMap theme={theme} imagery={activeImage.status === 'ready' ? imagery : 'none'} imageryTime={activeImage.time}
        labels={{ cloudsUnavailable: t('weather.cloudsUnavailable') }} />
      <p role="status" className="absolute bottom-4 left-4 z-10 max-w-sm rounded-md bg-occ-panel/90 p-3 text-xs text-occ-text backdrop-blur-lg">
        <ImageTimestamp t={t} locale={locale} image={activeImage} now={now} />
        {' · '}{t(`weather.sourceLayer.${imagery}`)}
        {' · '}{t('weather.opacity', { percent: Math.round(SATELLITE_OPACITY[imagery] * 100) })}
      </p>
    </MapExpandDialog>
  );
}

// Panel meteorológico de la consola: solo muestra variables presentes en el último METAR de
// MDPC, con su hora de observación, su antigüedad y su procedencia no oficial.
export default function WeatherPanel({ t, locale, theme, weather, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const [imagery, setImagery] = useState('goes');
  const [image, setImage] = useState({ goes: { status: 'loading', time: null }, imerg: { status: 'loading', time: null } });
  const now = useNow();
  const observation = weather?.data;
  const metar = observation?.metar;

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      for (const layer of ['goes', 'imerg']) {
        loadSatelliteImageInfo(layer, { signal: controller.signal })
          .then(info => {
            if (!controller.signal.aborted) setImage(previous => ({ ...previous, [layer]: info
              ? { status: 'ready', ...info } : { status: 'unavailable', time: null } }));
          })
          .catch(error => {
            if (!controller.signal.aborted && !isAbortError(error)) setImage(previous => ({ ...previous, [layer]: { status: 'unavailable', time: null } }));
          });
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 10 * 60_000);
    return () => { window.clearInterval(timer); abortForEffectCleanup(controller); };
  }, []);

  const activeImage = image[imagery];

  return (
    <ConsolePanel className={`occ-dashboard-map-panel ${className}`} title={t('weather.title')}
      meta={<span className="rounded border border-occ-line-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-occ-muted">{t('weather.unofficial')}</span>}
      actions={<ExpandButton label={t('weather.expand')} onClick={() => setExpanded(true)} />}
      bodyClassName="flex flex-col">
      <div className="relative min-h-[190px] flex-1">
        {!expanded && <GoesCloudMap theme={theme} imagery={activeImage.status === 'ready' ? imagery : 'none'} imageryTime={activeImage.time}
          labels={{ cloudsUnavailable: t('weather.cloudsUnavailable') }} />}
        {activeImage.status !== 'ready' && !expanded && <p role="status" className="absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-occ-line bg-occ-panel/90 p-2.5 text-xs text-occ-text shadow-sm backdrop-blur-lg">
          {t(activeImage.status === 'loading' ? 'weather.imageChecking' : 'weather.imageUnavailable')}
        </p>}
      </div>
      <div className="flex flex-col items-start gap-1.5 border-t border-occ-line px-3 py-2 text-[11px] text-occ-muted">
        <ImageryChoices t={t} imagery={imagery} onChange={setImagery} />
        <span className="w-full min-w-0 leading-relaxed">
          {t(`weather.sourceLayer.${imagery}`)}
          {' · '}<ImageTimestamp t={t} locale={locale} image={activeImage} now={now} />
          {' · '}{t(`weather.legend.${imagery}`)}
          {' · '}{t('weather.opacity', { percent: Math.round(SATELLITE_OPACITY[imagery] * 100) })}
        </span>
      </div>
      <div className="space-y-3 border-t border-occ-line px-4 py-3">
      {!observation && weather?.status === 'loading' && <p className="text-xs text-occ-muted">{t('weather.loading')}</p>}
      {!observation && weather?.status === 'error' && (
        <div role="alert" className="space-y-2">
          <p className="text-xs text-occ-text">{t('weather.error')}</p>
          <button type="button" onClick={weather.refresh}
            className="h-8 rounded-md border border-occ-line px-3 text-xs font-semibold text-occ-text hover:bg-occ-panel-muted">{t('weather.retry')}</button>
        </div>
      )}
      {observation && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <p className="font-mono text-3xl font-semibold leading-none text-occ-text">
              {metar.temperatureC != null ? `${metar.temperatureC}°` : '—'}<span className="ml-0.5 text-base text-occ-muted">C</span>
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <WindArrow directionDeg={metar.wind?.variable ? null : metar.wind?.directionDeg} />
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-occ-muted">{t('weather.wind')}</p>
                <p className="font-mono text-sm text-occ-text">{describeWind(t, metar.wind)}</p>
              </div>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-3 border-t border-occ-line pt-3">
            <Variable label={t('weather.visibility')} value={describeVisibility(t, metar.visibility)} />
            <Variable label={t('weather.clouds')} value={describeClouds(t, metar.clouds)} />
            <Variable label={t('weather.qnh')} value={metar.qnhHpa != null ? `${metar.qnhHpa} hPa` : '—'} />
          </dl>
          {metar.weather.length > 0 && (
            <p className="text-xs text-occ-text">{metar.weather.map(item => describeWeather(t, item)).join(', ')}</p>
          )}
          <Freshness t={t} locale={locale} observedAt={observation.observedAt} fetchedAt={weather.fetchedAt}
            now={now} refreshFailed={weather.refreshFailed} refreshing={weather.refreshing} />
          <a href={observation.source.url} target="_blank" rel="noreferrer"
            className="inline-block text-[10.5px] text-occ-muted underline underline-offset-2">{t('weather.sourceCompact')}</a>
        </div>
      )}
      </div>
      {expanded && <ExpandedWeather t={t} locale={locale} theme={theme} weather={weather} now={now}
        onClose={() => setExpanded(false)} image={image} imagery={imagery} setImagery={setImagery} />}
    </ConsolePanel>
  );
}
