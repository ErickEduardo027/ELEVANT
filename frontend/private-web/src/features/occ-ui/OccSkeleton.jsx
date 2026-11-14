'use client';

import { useTranslation } from '../../i18n/LanguageScope';
import { occUiMessages } from './occUiMessages';

/** The shapes a first load can take: list rows, stat tiles, lines of text, or the area of a map. */
export const OCC_SKELETON_VARIANTS = Object.freeze(['rows', 'tiles', 'text', 'map']);

// Static raised slabs on the plate radius: nothing shimmers or pulses (design H.2, quiet motion).
const BLOCK = 'rounded-sm bg-occ-panel-raised';
// The lines of a paragraph end at different lengths, so a text placeholder does not read as a table.
const LINE_WIDTHS = Object.freeze(['w-full', 'w-11/12', 'w-4/5', 'w-2/3']);
const DEFAULT_COUNT = 3;

const countOf = rows => {
  const count = Math.floor(Number(rows));
  return Number.isFinite(count) && count > 0 ? count : DEFAULT_COUNT;
};

function Blocks({ variant, count }) {
  const keys = Array.from({ length: count }, (_, index) => index);
  if (variant === 'map') return <span data-occ-skeleton-block="" className={`block h-full min-h-40 w-full ${BLOCK}`} />;
  if (variant === 'tiles') {
    return (
      <span className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
        {keys.map(key => (
          <span key={key} data-occ-skeleton-block="" className="flex flex-col gap-1.5">
            <span className={`h-3 w-2/3 ${BLOCK}`} />
            <span className={`h-7 w-1/2 ${BLOCK}`} />
          </span>
        ))}
      </span>
    );
  }
  if (variant === 'text') {
    return (
      <span className="flex flex-col gap-2">
        {keys.map(key => (
          <span key={key} data-occ-skeleton-block="" className={`h-3.5 ${LINE_WIDTHS[key % LINE_WIDTHS.length]} ${BLOCK}`} />
        ))}
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-2">
      {keys.map(key => (
        <span key={key} data-occ-skeleton-block="" className="flex items-center gap-2">
          <span className={`h-5 w-14 shrink-0 ${BLOCK}`} />
          <span className={`h-4 flex-1 ${BLOCK}`} />
        </span>
      ))}
    </span>
  );
}

/**
 * What a panel shows on its first load (design F): static slabs in the shape of what is coming, never a zero or an
 * empty list in its place. It is a `status` whose only words are a hidden label (`label`, «Cargando…» by default),
 * so assistive technology hears that something loads and nothing else; the slabs are hidden from it.
 * - `variant`: `rows` (a list), `tiles` (stat tiles), `text` (lines of text) or `map` (the whole area of a map).
 * - `rows`: how many rows, tiles or lines (3 by default); `map` draws one slab.
 * It has no padding of its own: the panel around it places it. An unknown variant throws.
 */
export default function OccSkeleton({ variant = 'rows', rows = DEFAULT_COUNT, label, className = '' }) {
  const { t } = useTranslation(occUiMessages);
  if (!OCC_SKELETON_VARIANTS.includes(variant)) throw new RangeError(`Unknown OCC skeleton variant: ${String(variant)}`);
  return (
    <div role="status" data-occ-skeleton={variant} className={`${variant === 'map' ? 'h-full' : ''} ${className}`}>
      <span className="sr-only">{label ?? t('skeleton.loading')}</span>
      <span aria-hidden="true" className={variant === 'map' ? 'block h-full' : 'block'}>
        <Blocks variant={variant} count={countOf(rows)} />
      </span>
    </div>
  );
}
