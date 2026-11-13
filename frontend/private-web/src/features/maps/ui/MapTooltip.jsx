import { useTranslation } from '../../../i18n/LanguageScope';
import { mapMessages } from '../mapMessages';

// The map tooltip of the airfield (PR M3): a small card, not a modal, that says what a runway or a taxiway is from the
// airport layout: «Pista 08/26 · 3100 m × 45 m», «Calle de rodaje A», or «Calle de rodaje sin nombre». OccMap owns
// when it shows (a hover shows it, a click holds it, a click elsewhere or another view closes it) and where: `x` and
// `y` are the pixel of the map it points at, and `alignX` / `alignY` ('start' or 'end') put the card on the side of
// that point with room, so it stays inside the map. It never takes the pointer, so the map under it keeps answering.

const OFFSET_PX = 12;
const shift = align => (align === 'end' ? `calc(-100% - ${OFFSET_PX}px)` : `${OFFSET_PX}px`);
const metres = value => String(Math.round(value));

/** The words of a tooltip: `{ title, detail }`, `detail` null when there is nothing to add. */
export function tooltipText(tooltip, t) {
  if (tooltip.kind === 'runway') {
    const sized = Number.isFinite(tooltip.lengthM) && Number.isFinite(tooltip.widthM);
    return {
      title: t('airfield.runway', { id: tooltip.ref ?? tooltip.id }),
      detail: sized ? t('airfield.size', { length: metres(tooltip.lengthM), width: metres(tooltip.widthM) }) : null,
    };
  }
  return { title: tooltip.ref ? t('airfield.taxiway', { ref: tooltip.ref }) : t('airfield.unnamed'), detail: null };
}

/**
 * `tooltip`: `{ kind: 'runway' | 'taxiway', id, ref, lengthM, widthM, x, y, alignX, alignY, pinned }`, or null for
 * nothing. A held card (`pinned`) has a stronger frame than one that follows the pointer.
 */
export default function MapTooltip({ tooltip }) {
  const { t } = useTranslation(mapMessages);
  if (!tooltip) return null;
  const { title, detail } = tooltipText(tooltip, t);
  return (
    <div
      role="tooltip"
      data-testid="map-tooltip"
      data-pinned={tooltip.pinned ? 'true' : 'false'}
      className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-md border bg-occ-panel-float px-3 py-1.5 text-sm text-occ-text ${tooltip.pinned ? 'border-occ-line-strong' : 'border-occ-line'}`}
      style={{ left: tooltip.x, top: tooltip.y, transform: `translate(${shift(tooltip.alignX)}, ${shift(tooltip.alignY)})` }}
    >
      <span className="font-semibold">{title}</span>
      {detail !== null && <span className="text-occ-muted">{` · ${detail}`}</span>}
    </div>
  );
}
