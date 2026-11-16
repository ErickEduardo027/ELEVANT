import { useTranslation } from '../../../i18n/LanguageScope';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccStandSwatch from '../../occ-ui/OccStandSwatch';
import { SIGNALS, STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { mapMessages } from '../mapMessages';
import { displayFromStatus, standStateOf } from '../stands/standModel';
import { locationOrigin, standAircraftOf, standCharacteristics, standStatus } from '../stands/standStatus';
import { stationTime } from '../traffic/stationTime';

// What a stand says of itself on the OCC maps (PR M4), for its drawer on Mapa de posiciones, the console's inspector
// and the panel beside the planning map. «Estado en el mapa»: its state in the words of the vocabulary (the board's
// status words do not know «Llegando» or «Por liberar») with its glyph, why it reads that state and since when, the next
// change expected with its time and countdown (owner request of 2026-11-15), who covers it, the reasons of its signals
// with their shape (PR M6: the plain notice «El avión ya está en la posición. Registra la llegada.» among them) and the
// milestones of the turnaround on it. «Características»: what the stand is, from the positions board and the airport
// layout (stands/standStatus.js). The map's tooltip and, zoomed in, its label say part of it, so nothing lives only on
// the map. Content of the maps lane; the drawer, the inspector and the panel only place it. No read is added.

export { locationOrigin };

const LOCATION_MESSAGES = Object.freeze({ occ: 'stand.located', reference: 'stand.reference', none: 'stand.unlocated' });
const SIGNAL_KINDS = new Set(['attention', 'urgent', 'notice']);
// The states with an aircraft on the stand, whose turnaround's progress the map draws.
const ON_STAND = new Set(['occupied', 'releasing']);
// The states whose aircraft the provider's facts (`aircraftFacts`) describe: parked or coming onto the stand.
const WITH_AIRCRAFT = new Set(['arriving', 'occupied', 'releasing']);

const cleanNames = names => [...new Set((Array.isArray(names) ? names : [])
  .map(name => String(name ?? '').trim()).filter(name => name !== ''))];

/** «18.56419° N, 68.36025° O»: a `[lng, lat]` centre in the screen's words. */
export function coordinatesText(center, t) {
  if (!Array.isArray(center)) return null;
  const [lng, lat] = center;
  const part = (value, positive, negative) => t('standInfo.coordinate', {
    value: Math.abs(value).toFixed(5), hemisphere: t(`standInfo.hemispheres.${value >= 0 ? positive : negative}`),
  });
  return `${part(lat, 'N', 'S')}, ${part(lng, 'E', 'W')}`;
}

/** The reason of a stand's state in words (standStatus's `reason`), its times written at the station. */
export function reasonText(reason, t, locale) {
  if (!reason) return null;
  const { key, params } = reason;
  const flight = params.flight ?? t('standStatus.unknownFlight');
  const time = at => stationTime(at, locale) ?? t('turnaround.unknown');
  const withMinutes = Number.isFinite(params.minutes) && params.minutes > 0;
  switch (key) {
    case 'planned':
      return t('standStatus.planned', { flight, arrival: time(params.arrivalAt) });
    case 'arriving':
      return t(withMinutes ? 'standStatus.arrivingIn' : 'standStatus.arriving',
        { flight, arrival: time(params.arrivalAt), minutes: params.minutes });
    case 'arrivingLanded':
      return t(withMinutes ? 'standStatus.arrivingLandedIn' : 'standStatus.arrivingLanded',
        { flight, landed: time(params.landedAt), minutes: params.minutes });
    case 'occupiedRecorded':
    case 'occupiedSeen':
      return t(`standStatus.${key}`, { flight, since: time(params.sinceAt) });
    case 'releasingScheduled':
    case 'releasingEstimated':
    case 'releasingLate':
      return t(`standStatus.${key}`, { departure: time(params.departureAt), minutes: params.minutes });
    default:
      return t(`standStatus.${key}`, { ...params, flight });
  }
}

/** The next change of a stand (standStatus's `next`) in words, with its countdown: «Pasa a Ocupada a las 13:12 · en 3 min». */
export function nextChangeText(next, t, locale) {
  if (!next) return null;
  const time = stationTime(next.at, locale);
  if (time === null) return null;
  const line = t(`standStatus.${next.key}`, { ...next.params, flight: next.params.flight ?? t('standStatus.unknownFlight'), time });
  const countdown = Number.isFinite(next.minutes) && next.minutes > 0
    ? t('standStatus.countdown', { minutes: next.minutes }) : t('standStatus.due');
  return `${line} · ${countdown}`;
}

function Characteristic({ fact, label, children }) {
  return (
    <div data-fact={fact} className="contents">
      <dt className="text-occ-muted">{label}</dt>
      <dd className="min-w-0 break-words text-occ-text">{children}</dd>
    </div>
  );
}

/**
 * The facts of `position`, a stand of a positions screen (positionsMapMappers.js), with how the screen reads it when it
 * derived that (useStandDisplay: `displayStatus`, `signals`, `display`), else its board status: a list named «Estado en
 * el mapa» and the «Características» of the stand. `layout` is the airport layout its geometry, code letter and taxiway
 * come from (MDPC by default). `aircraftFacts` is an optional slot under the state for the aircraft parked on the stand
 * or arriving at it: a node, or a function of that aircraft (stands/standStatus.js: standAircraftOf, `{ registration,
 * isDemo, flightNumber, aircraftType, state }`) that returns one; it is not drawn for a stand without such an aircraft.
 */
export default function StandDetailFacts({ position, layout = MDPC_LAYOUT, aircraftFacts = null, className = '' }) {
  const { t, language, locale } = useTranslation(mapMessages);
  if (!position) return null;
  const word = entry => entry[language] ?? entry.es;
  const state = standStateOf(position);
  const display = position.display ?? displayFromStatus(position);
  const names = cleanNames(position.coveredBy);
  const signals = (Array.isArray(position.signals) ? position.signals : display.signals ?? [])
    .filter(signal => signal?.reason && SIGNAL_KINDS.has(signal.kind));
  // The progress of the turnaround on the stand, as its bar draws it: while its aircraft is on it and the milestones
  // are known (PR M6).
  const progress = ON_STAND.has(state) && Number.isInteger(display.milestonesDone)
    && display.milestonesTotal > 0 ? { done: display.milestonesDone, total: display.milestonesTotal } : null;
  const status = standStatus(position);
  const reason = reasonText(status.reason, t, locale);
  const nextChange = nextChangeText(status.next, t, locale);
  const facts = standCharacteristics(position, layout);
  const aircraft = WITH_AIRCRAFT.has(state) ? standAircraftOf(position) : null;
  const slot = aircraft !== null && aircraftFacts !== null
    ? (typeof aircraftFacts === 'function' ? aircraftFacts(aircraft) : aircraftFacts) : null;
  const constraints = [
    facts.cancelledBy ? <li key="cancelled" data-fact="cancelled">{t('stand.cancelledBy', { code: facts.cancelledBy })}</li> : null,
    facts.narrowbodyOnly ? <li key="narrowbody" data-fact="narrowbody">{t('stand.narrowbodyOnly')}</li> : null,
    facts.overlaps.length > 0
      ? <li key="overlaps" data-fact="overlaps">{t('standInfo.overlaps', { codes: facts.overlaps.join(', ') })}</li> : null,
  ].filter(Boolean);
  let access = null;
  if (facts.access === 'fbo') access = t('standInfo.fbo');
  else if (facts.access) access = t(`standInfo.${facts.access}`);
  let size = null;
  if (facts.sizeLetter && facts.wingspanLimitM) {
    size = t('standInfo.sizeLetter', { letter: facts.sizeLetter, span: facts.wingspanLimitM });
  } else if (facts.sizeLetter) size = t('standInfo.sizeLetterOnly', { letter: facts.sizeLetter });
  // Who covers it is said once, in the state list («Cubre …»); here only that nobody does, when the screen knows it.
  const coverage = names.length === 0 && facts.coveredBy !== null ? t('standInfo.noCoverage') : null;

  return (
    <div data-testid="stand-detail-facts" data-state={state} className={`space-y-2 text-sm text-occ-text ${className}`.trim()}>
      <ul aria-label={t('facts.label')} className="space-y-1.5 rounded-md border border-occ-line bg-occ-panel px-3 py-2">
        <li className="flex items-center gap-2" data-fact="state" data-state={state}>
          <OccStandSwatch state={state} />
          <span className="font-semibold">{word(STAND_STATES[state])}</span>
        </li>
        {reason && <li data-fact="reason" data-reason={status.reason.key}>{reason}</li>}
        {nextChange && (
          <li data-fact="next-change" data-next={status.next.key} className="text-xs tabular-nums text-occ-text">
            <span className="mr-1.5 font-semibold uppercase tracking-wide text-occ-muted">{t('standStatus.nextChange')}</span>{' '}
            {nextChange}
          </li>
        )}
        {names.length > 0 && (
          <li data-fact="coverage">
            {t('stand.coveredBy', { names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(names) })}
          </li>
        )}
        {signals.map(signal => (
          <li key={`${signal.kind}:${signal.reason}`} data-fact="signal" data-signal={signal.kind} className="flex items-center gap-2">
            <OccGlyph name={signal.kind} title={word(SIGNALS[signal.kind])} />
            <span>{t(`stand.${signal.reason}`)}</span>
          </li>
        ))}
        {progress !== null && <li data-fact="progress">{t('stand.progress', progress)}</li>}
      </ul>
      {slot ? <div data-slot="aircraft-facts">{slot}</div> : null}
      <section aria-label={t('standInfo.label')} data-testid="stand-characteristics"
        className="rounded-md border border-occ-line bg-occ-panel px-3 py-2">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-occ-muted">{t('standInfo.label')}</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {/* No code row: the drawer's title and the inspector's plate already name the stand. */}
          {(facts.terminal || access) && (
            <Characteristic fact="kind" label={t('standInfo.kind')}>
              {[facts.terminal ? t('standInfo.terminal', { terminal: facts.terminal }) : null, access].filter(Boolean).join(' · ')}
            </Characteristic>
          )}
          {(size || facts.maxAircraft) && (
            <Characteristic fact="size" label={t('standInfo.size')}>
              {[size, facts.maxAircraft ? t('standInfo.maxAircraft', { size: facts.maxAircraft }) : null].filter(Boolean).join(' · ')}
            </Characteristic>
          )}
          {facts.nose && (
            <Characteristic fact="heading" label={t('standInfo.heading')}>
              {t('standInfo.nose', { direction: t(`standInfo.directions.${facts.nose}`), degrees: facts.headingTrue })}
            </Characteristic>
          )}
          {facts.lengthM && facts.widthM && (
            <Characteristic fact="dimensions" label={t('standInfo.dimensions')}>
              {t('standInfo.dimensionsValue', { length: facts.lengthM, width: facts.widthM })}
            </Characteristic>
          )}
          {facts.center && (
            <Characteristic fact="center" label={t('standInfo.center')}>
              <span className="font-mono">{coordinatesText(facts.center, t)}</span>
            </Characteristic>
          )}
          {facts.taxiway && (
            <Characteristic fact="taxiway" label={t('standInfo.taxiway')}>{t('standInfo.taxiwayValue', { ref: facts.taxiway })}</Characteristic>
          )}
          {constraints.length > 0 && (
            <Characteristic fact="constraints" label={t('standInfo.constraints')}>
              <ul className="space-y-0.5">{constraints}</ul>
            </Characteristic>
          )}
          <Characteristic fact="location" label={t('standInfo.location')}>
            <span data-origin={facts.origin} className="inline-flex flex-wrap items-center gap-1.5">
              {facts.origin === 'reference' && (
                <span className="shrink-0 rounded-sm border border-occ-line-strong px-1 text-xs font-semibold">{word(TAGS.unofficial)}</span>
              )}
              <span>{t(LOCATION_MESSAGES[facts.origin])}</span>
            </span>
          </Characteristic>
          {coverage && <Characteristic fact="coverage-agents" label={t('standInfo.coverage')}>{coverage}</Characteristic>}
        </dl>
      </section>
    </div>
  );
}
