import { useTranslation } from '../../../i18n/LanguageScope';
import OccGlyph from '../../occ-ui/OccGlyph';
import { SIGNALS } from '../../occ-ui/statusVocabulary';
import { mapMessages } from '../mapMessages';

// The map tooltip (PR M3, stands in PR M4): a small card, not a modal, that says what is under the pointer. A runway or
// a taxiway says what the airport layout says of it: «Pista 08/26 · 3100 m × 45 m», «Calle de rodaje A», or «Calle de
// rodaje sin nombre». A stand says its code and state, its flight and who covers it, and the reasons of its signals
// with their shape (stands/standInteractions.js: standTooltip); its drawer and its label carry the same facts. OccMap
// owns when it shows (a hover shows it; a click holds the card of a runway or a taxiway and selects a stand; a click
// elsewhere or another view closes it) and where: `x` and `y` are the pixel of the map it points at, and `alignX` /
// `alignY` ('start' or 'end') put the card on the side of that point with room, so it stays inside the map. It never
// takes the pointer, so the map under it keeps answering.

const OFFSET_PX = 12;
const shift = align => (align === 'end' ? `calc(-100% - ${OFFSET_PX}px)` : `${OFFSET_PX}px`);
const metres = value => String(Math.round(value));
const placed = tooltip => ({ left: tooltip.x, top: tooltip.y, transform: `translate(${shift(tooltip.alignX)}, ${shift(tooltip.alignY)})` });

// The card of an aircraft (ui/aircraftCard.js, owner request of 2026-11-15): its callsign large with its flight number
// and ADS-B address, then its facts two columns wide, an unknown one as a dash.
function AircraftTooltip({ tooltip, t }) {
  return (
    <div
      role="tooltip"
      data-testid="map-tooltip"
      data-kind="aircraft"
      data-source={tooltip.source}
      data-pinned={tooltip.pinned ? 'true' : 'false'}
      className={`pointer-events-none absolute z-20 w-64 rounded-md border border-l-2 border-l-occ-accent bg-occ-panel-float px-3 py-2 text-sm text-occ-text ${tooltip.pinned ? 'border-occ-line-strong' : 'border-occ-line'}`}
      style={placed(tooltip)}
    >
      <span className="block font-mono text-lg font-semibold leading-6">{tooltip.title}</span>
      {tooltip.subtitle && <span className="block font-mono text-xs text-occ-muted">{tooltip.subtitle}</span>}
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {tooltip.facts.map(fact => (
          <div key={fact.key} data-fact={fact.key} className="contents">
            <dt className="text-occ-muted">{t(`aircraftCard.${fact.key}`)}</dt>
            <dd className="truncate font-semibold">{fact.value ?? t('aircraftCard.unknown')}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The words of a tooltip: `{ title, detail, reasons }`, `detail` null when there is nothing to add and `reasons` the
 * extra lines of a stand (`[{ signal, text }]`, empty for anything else).
 */
export function tooltipText(tooltip, t) {
  if (tooltip.kind === 'stand') {
    return { title: tooltip.title, detail: tooltip.detail ?? null, reasons: Array.isArray(tooltip.reasons) ? tooltip.reasons : [] };
  }
  if (tooltip.kind === 'runway') {
    const sized = Number.isFinite(tooltip.lengthM) && Number.isFinite(tooltip.widthM);
    return {
      title: t('airfield.runway', { id: tooltip.ref ?? tooltip.id }),
      detail: sized ? t('airfield.size', { length: metres(tooltip.lengthM), width: metres(tooltip.widthM) }) : null,
      reasons: [],
    };
  }
  return { title: tooltip.ref ? t('airfield.taxiway', { ref: tooltip.ref }) : t('airfield.unnamed'), detail: null, reasons: [] };
}

/**
 * `tooltip`: `{ kind: 'runway' | 'taxiway', id, ref, lengthM, widthM }` or `{ kind: 'stand', id, title, detail,
 * reasons }`, with `x`, `y`, `alignX`, `alignY` and `pinned`; or null for nothing. A held card (`pinned`) has a
 * stronger frame than one that follows the pointer.
 */
export default function MapTooltip({ tooltip }) {
  const { t, language } = useTranslation(mapMessages);
  if (!tooltip) return null;
  if (tooltip.kind === 'aircraft') return <AircraftTooltip tooltip={tooltip} t={t} />;
  const { title, detail, reasons } = tooltipText(tooltip, t);
  const stand = tooltip.kind === 'stand';
  return (
    <div
      role="tooltip"
      data-testid="map-tooltip"
      data-kind={tooltip.kind}
      data-pinned={tooltip.pinned ? 'true' : 'false'}
      className={`pointer-events-none absolute z-20 rounded-md border bg-occ-panel-float px-3 py-1.5 text-sm text-occ-text ${stand ? 'max-w-xs' : 'whitespace-nowrap'} ${tooltip.pinned ? 'border-occ-line-strong' : 'border-occ-line'}`}
      style={placed(tooltip)}
    >
      {stand ? (
        <>
          <span className="block whitespace-nowrap font-semibold">{title}</span>
          {detail !== null && <span className="block text-occ-muted">{detail}</span>}
          {reasons.map(reason => (
            <span key={reason.text} className="mt-0.5 flex items-center gap-1.5">
              {reason.signal && <OccGlyph name={reason.signal} title={SIGNALS[reason.signal][language] ?? SIGNALS[reason.signal].es} />}
              <span>{reason.text}</span>
            </span>
          ))}
        </>
      ) : (
        <>
          <span className="font-semibold">{title}</span>
          {detail !== null && <span className="text-occ-muted">{` · ${detail}`}</span>}
        </>
      )}
    </div>
  );
}
