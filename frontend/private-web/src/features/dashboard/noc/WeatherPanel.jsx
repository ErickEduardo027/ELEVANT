'use client';

import { useTranslation } from '../../../i18n/LanguageScope';
import { BUSINESS_TIME_ZONE } from '../../../services/businessDay';
import { MDPC_LAYOUT } from '../../maps/airport/airportLayout';
import { PUJ_ARP } from '../../maps/core/cameraPresets';
import { mapMessages } from '../../maps/mapMessages';
import { mapRunwayInUse, runwayInUseLabel } from '../../maps/traffic/referenceFeatures';
import { sunTimes } from '../../maps/traffic/solar';
import { stationTime } from '../../maps/traffic/stationTime';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import OccTimeline from '../../occ-ui/OccTimeline';
import { describeTafPeriod, tafReadout } from '../../weather/taf';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_SCROLL } from './consoleStyles';
import { Freshness, Observation, useNow, WEATHER_LABEL, WEATHER_TAG } from './WeatherObservation';
import { WeatherCredit, WeatherState } from './WeatherPill';
import { componentWords, flightCategoryOf, runwayRows, tafBand } from './weatherPanelModel';

// The floating panel «Meteorología PUJ» of the console (lane M7, 2026-11-27; plan: Panorama meteorológico): everything
// the aerodrome weather of Punta Cana says, always on screen and never behind a hover (contratos 2.4). The decoded
// METAR of MDPC with the server's flight category as a word and its aviation colour (owner exception of 2026-11-26),
// the TAF as a band of time (occ-ui/OccTimeline.jsx) with what holds now and next, the head or tail and cross wind on
// each runway end with the gust's (airport/runwayWind.js), the runway in use and why, the sun's day at PUJ computed
// from traffic/solar.js, the freshness, «No oficial» and the credit of NOAA Aviation Weather Center. It reads nothing:
// `weather` is useMdpcWeather's view; the console places it (`className`) and measures it (`ref`).

const SECTION = 'space-y-1.5';

// «dom 29»: the weekday and the day at the station of an instant, and its date as a key, to say on which day a TAF
// that runs past midnight ends (a 24 h TAF otherwise reads «de las 08:00 a las 08:00»). `null` without an instant.
function stationDay(at, locale) {
  if (!Number.isFinite(at)) return null;
  try {
    const parts = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', timeZone: BUSINESS_TIME_ZONE })
      .formatToParts(new Date(at));
    const part = type => parts.find(item => item.type === type)?.value ?? '';
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIME_ZONE }).format(new Date(at));
    return { key, label: `${part('weekday')} ${part('day')}` };
  } catch {
    return null;
  }
}

function tafValidity(t, model, locale) {
  const from = stationTime(model.validFrom, locale);
  const to = stationTime(model.validTo, locale);
  const [fromDay, toDay] = [stationDay(model.validFrom, locale), stationDay(model.validTo, locale)];
  if (fromDay && toDay && fromDay.key !== toDay.key) return t('weather.panel.tafValidUntilDay', { from, to, day: toDay.label });
  return t('weather.panel.tafValid', { from, to });
}

function Section({ title, meta, children }) {
  return (
    <section className={SECTION}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className={WEATHER_LABEL}>{title}</h3>
        {meta ? <span className="text-xs text-occ-muted">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function FlightCategory({ t, observation }) {
  const category = flightCategoryOf(observation);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-occ-text" data-flight-category={category.code ?? 'none'}>
      <span className={WEATHER_LABEL}>{t('weather.panel.category')}</span>
      {category.code ? (
        <span aria-hidden="true" data-category-chip="" className="inline-block h-3 w-3 shrink-0 rounded-sm"
          style={{ backgroundColor: category.color }} />
      ) : (
        <span aria-hidden="true" data-category-chip="" className="inline-block h-3 w-3 shrink-0 rounded-sm border border-occ-muted" />
      )}
      <span className="font-semibold">{t(`weather.panel.categories.${category.code ?? 'none'}`)}</span>
      {category.code ? <span className="text-xs text-occ-muted">{t('weather.panel.categoryNote')}</span> : null}
    </p>
  );
}

function Forecast({ t, language, locale, weather, nowMs }) {
  const model = weather?.taf ?? null;
  const mapT = useTranslation(mapMessages).t;
  if (!model) return <Section title={t('weather.panel.taf')}><p className="text-xs text-occ-muted">{t('weather.panel.tafNone')}</p></Section>;
  const band = tafBand(model, nowMs, { language });
  const readout = tafReadout(model, nowMs);
  const meta = tafValidity(t, model, locale);
  let lines;
  if (readout.state === 'expired') lines = [mapT('weather.taf.expired')];
  else if (readout.state === 'none') lines = [mapT('weather.taf.none')];
  else {
    lines = readout.current.map(period => t('weather.panel.tafNow', { period: describeTafPeriod(period, { language }) }));
    if (readout.next) lines.push(t('weather.panel.tafNext', { period: describeTafPeriod(readout.next, { language }) }));
  }
  return (
    <Section title={t('weather.panel.taf')} meta={meta}>
      {band ? (
        <OccTimeline label={t('weather.panel.tafBand')} rows={band.rows} windowStart={band.windowStart}
          windowEnd={band.windowEnd} now={nowMs} timeZone={BUSINESS_TIME_ZONE} density="compact" plateKind="code"
          barName={bar => bar.name} barText={bar => bar.text} />
      ) : null}
      <ul className="space-y-0.5 text-xs text-occ-text" data-taf-readout={readout.state}>
        {lines.map(line => <li key={line}>{line}</li>)}
      </ul>
      <p className="text-xs text-occ-muted">
        {t('weather.panel.tafIssued', { time: stationTime(model.issuedAt, locale) })}
      </p>
    </Section>
  );
}

function RunwayWinds({ t, language, observation, runway, inUseLabel }) {
  const rows = observation ? runwayRows(observation.metar?.wind ?? null, { runway }) : [];
  const anyGust = rows.some(row => row.gust);
  let body;
  if (!observation) body = <p className="text-xs text-occ-muted">{t('weather.panel.runwayNoMetar')}</p>;
  else if (rows.length === 0) body = <p className="text-xs text-occ-muted">{t('weather.panel.runwayNoWind')}</p>;
  else {
    body = (
      <table className="w-full table-fixed text-left text-xs text-occ-text">
        <thead className="text-occ-muted">
          <tr>
            <th scope="col" className="w-16 py-0.5 font-medium">{t('weather.panel.runway')}</th>
            <th scope="col" className="py-0.5 font-medium">{t('weather.panel.along')}</th>
            <th scope="col" className="py-0.5 font-medium">{t('weather.panel.across')}</th>
            {anyGust ? <th scope="col" className="py-0.5 font-medium">{t('weather.panel.gust')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const words = componentWords(row, language);
            const gust = row.gust ? componentWords(row.gust, language) : null;
            return (
              <tr key={row.ident} data-runway={row.ident} data-in-use={row.inUse ? 'true' : undefined}
                className={`border-t border-occ-line ${row.inUse ? 'font-semibold' : ''}`}>
                <th scope="row" className="py-0.5 font-mono">
                  {row.label}
                  {row.inUse ? <span className="ml-1 font-sans text-occ-muted">{t('weather.panel.runwayInUse')}</span> : null}
                </th>
                <td className="py-0.5">{words.along}</td>
                <td className="py-0.5">{words.across}</td>
                {anyGust ? <td className="py-0.5">{gust ? `${gust.along} · ${gust.across}` : '—'}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }
  return (
    <Section title={t('weather.panel.runways')} meta={inUseLabel ? t('weather.panel.inUse', { runway: inUseLabel }) : null}>
      {body}
    </Section>
  );
}

function SunDay({ t, locale, nowMs }) {
  const day = Number.isFinite(nowMs) ? sunTimes(nowMs, PUJ_ARP) : null;
  const entries = ['dawn', 'sunrise', 'sunset', 'dusk'];
  return (
    <Section title={t('weather.panel.sun')} meta={t('weather.panel.sunNote')}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {entries.map(key => (
          <div key={key} className="flex min-w-0 items-baseline justify-between gap-2" data-sun={key}>
            <dt className="text-occ-muted">{t(`weather.panel.${key}`)}</dt>
            <dd className="font-mono text-occ-text">{stationTime(day?.[key] ?? null, locale) ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/**
 * The panel. `weather` is useMdpcWeather's view (`status`, `data`, `apiStatus`, `taf`, `source`, `fetchedAt`,
 * `refreshing`, `refreshFailed`, `refresh`); `nowMs` the server's time (the device's, read every minute, without one);
 * `runway` the map's runway in use (traffic/referenceFeatures.js: mapRunwayInUse, with the arrivals it saw), else the
 * one the weather alone gives. `panelLayout` is OccFloatingPanel's layout (`float` over the map); the panel folds to
 * its title and remembers it as `pan-weather`.
 */
export default function WeatherPanel({
  ref, weather, nowMs, runway = null, layout = MDPC_LAYOUT, panelLayout = 'float', defaultFolded = false, className = '',
}) {
  const { t, language, locale } = useTranslation(consoleMessages);
  const deviceNow = useNow();
  const now = Number.isFinite(nowMs) ? nowMs : deviceNow;
  const observation = weather?.data ?? null;
  const inUse = runway ?? mapRunwayInUse({ layout, weather, nowMs: now });
  const source = observation?.source ?? weather?.source ?? null;
  return (
    <OccFloatingPanel ref={ref} panelId="pan-weather" title={t('weather.panel.title')} layout={panelLayout}
      defaultFolded={defaultFolded} className={className} bodyClassName="h-full min-h-0" data-testid="weather-panel"
      meta={<span className={`${WEATHER_TAG} text-occ-muted`}>{t('weather.unofficial')}</span>}>
      {/* It scrolls inside the room the console's right column gives it (M1), and never past 40 rem. */}
      <div className={`h-full max-h-[min(40rem,calc(100dvh_-_12rem))] min-h-0 space-y-4 p-3 ${CONSOLE_SCROLL}`}>
        <Section title={t('weather.panel.metar')}>
          <WeatherState t={t} weather={weather} />
          {observation ? (
            <>
              <FlightCategory t={t} observation={observation} />
              <Observation t={t} observation={observation} />
              <p className="break-words rounded-sm bg-occ-panel p-2 font-mono text-xs text-occ-text">{observation.metar.raw}</p>
              <Freshness t={t} locale={locale} weather={weather} now={now} />
            </>
          ) : null}
        </Section>
        <Forecast t={t} language={language} locale={locale} weather={weather} nowMs={now} />
        <RunwayWinds t={t} language={language} observation={observation} runway={inUse}
          inUseLabel={runwayInUseLabel(inUse, language)} />
        <SunDay t={t} locale={locale} nowMs={now} />
        <WeatherCredit t={t} source={source} messageKey="weather.panel.credit" />
      </div>
    </OccFloatingPanel>
  );
}
