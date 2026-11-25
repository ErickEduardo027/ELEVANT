'use client';

import { useTranslation } from '../../i18n/LanguageScope';
import { delayChipOf } from './occDelay';
import OccGlyph from './OccGlyph';
import { occUiMessages } from './occUiMessages';
import { SIGNALS } from './statusVocabulary';

/**
 * The delay of a leg (CN-32, occDelay.js): «+12» minutes in Plex Mono on a plate, with no hue below 15 minutes and
 * the amber triangle from 15 («cabina oscura», ADR-0044), never colour alone. It reads «12 min de demora» (with
 * «Atención» first when it asks for attention) for assistive technology. Nothing below DELAY_SHOWN_MIN. `data-occ-delay`
 * carries the minutes and `data-signal` the signal.
 */
export default function OccDelayChip({ minutes, className = '' }) {
  const { t, language } = useTranslation(occUiMessages);
  const chip = delayChipOf(minutes);
  if (chip === null) return null;
  return (
    <span data-occ-delay={chip.minutes} data-signal={chip.signal ?? 'none'}
      className={`inline-flex shrink-0 items-center gap-1 rounded-[2px] border border-occ-line-strong px-1 font-mono text-xs font-semibold leading-5 tabular-nums text-occ-text ${className}`}>
      {chip.signal ? <OccGlyph name={chip.signal} /> : null}
      <span aria-hidden="true">{`+${chip.minutes}`}</span>
      <span className="sr-only">
        {chip.signal ? `${SIGNALS[chip.signal][language]}: ` : ''}{t('delay.name', { count: chip.minutes })}
      </span>
    </span>
  );
}
