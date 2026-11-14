import { localeFor } from '../../../i18n/languageStore';
import { BUSINESS_TIME_ZONE } from '../../../services/businessDay';
import { TAGS } from '../../occ-ui/statusVocabulary';

// The time at the station of what the map shows, and the words of a position without recent signal (contracts 2.4):
// the aircraft's tag and its data block both say «Sin actualizar desde las 14:02», the stale tag of
// occ-ui/statusVocabulary.js (TAGS.stale) with the time at the station of the aircraft's last position, never its age,
// so a stale aircraft reads the same on every screen. The data block's times («Llega 11:10») use the same clock. Pure.

const finite = value => typeof value === 'number' && Number.isFinite(value);
const formatters = new Map();

function formatter(locale) {
  if (!formatters.has(locale)) {
    formatters.set(locale, new Intl.DateTimeFormat(locale, {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: BUSINESS_TIME_ZONE,
    }));
  }
  return formatters.get(locale);
}

/**
 * «14:02»: the 24-hour time at the station (Punta Cana, America/Santo_Domingo) of an instant in milliseconds, written
 * for `locale`; a runtime that does not know the zone gets the UTC time. `null` without an instant.
 */
export function stationTime(at, locale = localeFor('es')) {
  if (!finite(at)) return null;
  try {
    return formatter(locale).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
}

/**
 * The words of a position without recent signal in `language`: «Sin actualizar desde las 14:02», with the station's
 * time of `positionAt` (milliseconds, the instant of the aircraft's last position); without that instant, the tag
 * alone («Sin actualizar»). The time does not age: the words stay the same until the aircraft gives a new position.
 */
export function staleWords(positionAt, language = 'es') {
  const time = stationTime(positionAt, localeFor(language));
  if (time === null) return TAGS.stale.short[language] ?? TAGS.stale.short.es;
  return (TAGS.stale[language] ?? TAGS.stale.es).replace('{time}', time);
}
