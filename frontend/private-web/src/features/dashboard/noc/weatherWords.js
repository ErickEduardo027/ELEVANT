// The words of a METAR observation (features/weather/metar.js: parseMetar), moved from the old dashboard's weather panel
// with the same text: the console's weather pill and its detail say them (WeatherPill.jsx). `t` translates a message
// file with the console's `weather.*` words (consoleMessages). Pure.

/** «fuerte tormenta lluvia»: the intensity, the descriptor and the phenomena of a present-weather group. */
export function describeWeather(t, item) {
  const parts = [];
  if (item.intensity) parts.push(t(`weather.intensity.${item.intensity}`));
  if (item.descriptor) parts.push(t(`weather.descriptor.${item.descriptor}`));
  item.phenomena.forEach(code => parts.push(t(`weather.phenomena.${code}`)));
  return parts.join(' ');
}

/** «Escasas 2,200 ft · Dispersas 4,000 ft CB», or «Sin nubes reportadas». */
export function describeClouds(t, clouds) {
  if (!clouds.length) return t('weather.noClouds');
  return clouds.map(layer => {
    const cover = t(`weather.cover.${layer.cover}`);
    const base = layer.baseFt != null ? ` ${layer.baseFt.toLocaleString('en-US')} ft` : '';
    return `${cover}${base}${layer.convective ? ` ${layer.convective}` : ''}`;
  }).join(' · ');
}

/** «10 km o más», «6 km», «2.4 km», or «—» without a visibility. */
export function describeVisibility(t, visibility) {
  if (!visibility) return '—';
  const km = visibility.meters / 1000;
  const value = km >= 5 ? Math.round(km) : Math.round(km * 10) / 10;
  return visibility.orMore ? t('weather.visibilityOrMore', { km: value }) : `${value} km`;
}

/** «100° · 13 kt · ráfagas 25 kt», «Variable · 3 kt», «Calma», or «—» without a wind. */
export function describeWind(t, wind) {
  if (!wind) return '—';
  if (wind.speedKt === 0) return t('weather.windCalm');
  const direction = wind.variable ? t('weather.windVariable') : `${String(wind.directionDeg).padStart(3, '0')}°`;
  const extras = [
    wind.gustKt ? t('weather.gust', { speed: wind.gustKt }) : null,
    wind.variableFrom != null ? t('weather.variableSector', { from: wind.variableFrom, to: wind.variableTo }) : null,
  ].filter(Boolean);
  return `${direction} · ${wind.speedKt} kt${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
}

/**
 * The key of what a weather surface says while it has no observation (useMdpcWeather's view: `status`, `apiStatus`,
 * `data`), or null once it has one (M7, 2026-11-27: before, the pill said «Consultando…» for ever when the weather
 * was empty or refused). `weather.forbidden` for a refused reader, `weather.error` for a failed first read,
 * `weather.disabled` or `weather.unavailable` for an answer without a METAR (Disabled, else Unavailable), and
 * `weather.loading` until the first answer.
 */
export function weatherStateKey(weather) {
  if (weather?.data) return null;
  if (weather?.status === 'unauthorized') return 'weather.forbidden';
  if (weather?.status === 'error') return 'weather.error';
  if (weather?.status === 'empty') return weather.apiStatus === 'Disabled' ? 'weather.disabled' : 'weather.unavailable';
  return 'weather.loading';
}
