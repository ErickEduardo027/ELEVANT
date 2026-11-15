import { useTranslation } from '../../../i18n/LanguageScope';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccStandSwatch from '../../occ-ui/OccStandSwatch';
import { SIGNALS, STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { mapMessages } from '../mapMessages';
import { displayFromStatus, standStateOf } from '../stands/standModel';

// What a stand says of itself on the OCC maps (PR M4), for its drawer on Mapa de posiciones and the panel beside the
// planning map: its state in the words of the vocabulary (the board's status words do not know «Llegando» or «Por
// liberar»), who covers it, the reasons of its signals with their shape (PR M6: the plain notice «El avión ya está en
// la posición. Registra la llegada.» among them), the milestones of the turnaround on it (PR M6: what its progress bar
// draws), the stand that cancels it, the narrow-body limit and where its location comes from. The map's tooltip and,
// zoomed in, its label say the same, so nothing lives only on the map. Content of the maps lane; the drawer and the
// panel only place it.

const LOCATION_MESSAGES = Object.freeze({ occ: 'stand.located', reference: 'stand.reference', none: 'stand.unlocated' });
const SIGNAL_KINDS = new Set(['attention', 'urgent', 'notice']);
// The states with an aircraft on the stand, whose turnaround's progress the map draws.
const ON_STAND = new Set(['occupied', 'releasing']);

const cleanNames = names => [...new Set((Array.isArray(names) ? names : [])
  .map(name => String(name ?? '').trim()).filter(name => name !== ''))];

/** Where a stand's location comes from: OCC placed it, it sits at the internal reference point, or it has none. */
export function locationOrigin(position) {
  if (position?.locationSource === 'occ') return 'occ';
  if (position?.locationSource === 'none') return 'none';
  return Number.isFinite(position?.latitude) && Number.isFinite(position?.longitude) ? 'reference' : 'none';
}

/**
 * The facts of `position`, a stand of a positions screen (positionsMapMappers.js), with how the screen reads it when it
 * derived that (useStandDisplay: `displayStatus`, `signals`, `display`), else its board status. Renders a list named
 * «Estado en el mapa».
 */
export default function StandDetailFacts({ position, className = '' }) {
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
  const cancelledBy = state === 'disabled' ? display.cancelledBy : null;
  const origin = locationOrigin(position);
  // What the stand is (owner request of 2026-11-15): its terminal, a bridge or remote, the largest aircraft it takes.
  const terminal = typeof position.terminal === 'string' && position.terminal !== '' ? position.terminal : null;
  let access = null;
  if (position.hasBoardingBridge === true) access = 'bridge';
  else if (position.isRemote === true) access = 'remote';
  else if (position.isRemote === false && position.standId != null) access = 'contact';
  const maxAircraft = typeof position.maxAircraftSize === 'string' && position.maxAircraftSize !== ''
    ? position.maxAircraftSize : null;

  return (
    <ul aria-label={t('facts.label')} data-testid="stand-detail-facts"
      className={`space-y-1.5 rounded-md border border-occ-line bg-occ-panel px-3 py-2 text-sm text-occ-text ${className}`.trim()}>
      <li className="flex items-center gap-2" data-fact="state" data-state={state}>
        <OccStandSwatch state={state} />
        <span className="font-semibold">{word(STAND_STATES[state])}</span>
      </li>
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
      {(terminal || access) && (
        <li data-fact="kind" className="text-occ-muted">
          {[terminal ? t('standInfo.terminal', { terminal }) : null, access ? t(`standInfo.${access}`) : null]
            .filter(Boolean).join(' · ')}
        </li>
      )}
      {maxAircraft && <li data-fact="max-aircraft" className="text-occ-muted">{t('standInfo.maxAircraft', { size: maxAircraft })}</li>}
      {cancelledBy && <li data-fact="cancelled">{t('stand.cancelledBy', { code: cancelledBy })}</li>}
      {position.narrowbodyOnly === true && <li data-fact="narrowbody">{t('stand.narrowbodyOnly')}</li>}
      <li data-fact="location" data-origin={origin} className="flex items-center gap-2 text-occ-muted">
        {origin === 'reference' && (
          <span className="shrink-0 rounded-sm border border-occ-line-strong px-1 text-xs font-semibold">{word(TAGS.unofficial)}</span>
        )}
        <span>{t(LOCATION_MESSAGES[origin])}</span>
      </li>
    </ul>
  );
}
