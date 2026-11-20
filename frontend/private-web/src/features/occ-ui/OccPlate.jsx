import { standDisplayCode } from '../../services/standCodes';

/** What a plate names: a stand, a flight, a registration, an IATA or ICAO code, or the station. */
export const PLATE_KINDS = Object.freeze(['stand', 'flight', 'registration', 'code', 'station']);

/**
 * An identifier drawn as a plate (contratos 2.4): IBM Plex Mono on a 2 px slab with a strong joint. It is text, not a
 * control: the selectable plate arrives with the console (U3). An unknown `kind` throws, like any vocabulary typo. A
 * stand's code is drawn as the map draws it (standDisplayCode, N27): the seed's «A01» is «A1» on every screen.
 */
export default function OccPlate({ kind = 'code', children, className = '' }) {
  if (!PLATE_KINDS.includes(kind)) throw new RangeError(`Unknown OCC plate kind: ${String(kind)}`);
  return (
    <span data-occ-plate={kind}
      className={`inline-flex shrink-0 items-center rounded-sm border border-occ-line-strong px-1.5 font-mono text-xs font-semibold leading-5 text-occ-text ${className}`}>
      {kind === 'stand' && typeof children === 'string' ? standDisplayCode(children) : children}
    </span>
  );
}
