'use client';

import { useTranslation } from '../../i18n/LanguageScope';
import { formatClock } from './occTime';
import { occUiMessages } from './occUiMessages';

/** `compact`: the four phases with their counts and ticks. `full`: also every milestone with its time. */
export const OCC_MILESTONE_VARIANTS = Object.freeze(['compact', 'full']);
/** `ready`: the phases of an operation. `empty`: the turnaround has no operation yet. */
export const OCC_MILESTONE_STATUSES = Object.freeze(['ready', 'empty']);

const NO_PHASES = Object.freeze([]);
// Compact, the four phases share one line: each label sits over its count, so the counts line up whatever the length
// of the label. Full, each phase has the width to put its count at the end of its label's line.
const PHASE_HEADER = Object.freeze({
  compact: 'flex flex-col text-xs',
  full: 'flex flex-wrap items-baseline justify-between gap-x-2 text-xs',
});
// A recorded milestone is a filled tick, a pending one a hollow tick: shape, not a hue. Both carry the same 1 px
// border, so every tick of a phase takes the same width.
const TICK = 'h-1.5 min-w-0 flex-1 rounded-[1px] border';
const TICK_DONE = 'border-occ-text bg-occ-text';
const TICK_PENDING = 'border-occ-line-strong';

/**
 * The milestone strip of a turnaround (design F, D22): the four phases of the flight report as an ordered list named
 * «Hitos de la escala», each with its label, «3 de 6» and one tick per milestone (filled = recorded, hollow = pending;
 * the ticks are hidden from assistive technology, the count says it). `phases` comes from buildMilestonePhases.
 * - `variant="full"` lists every milestone of each phase with its time («14:41», in `timeZone`) or «Pendiente».
 * - `status="empty"` says that the milestones appear once the turnaround has an operation.
 * There is no «behind schedule» colour: no milestone has a target time (contratos 1.3). An unknown variant or status
 * throws.
 */
export default function OccMilestoneStrip({
  phases = NO_PHASES, variant = 'compact', status = 'ready', locale, timeZone = 'UTC', className = '',
}) {
  const { t, locale: languageLocale } = useTranslation(occUiMessages);
  if (!OCC_MILESTONE_VARIANTS.includes(variant)) throw new RangeError(`Unknown OCC milestone strip variant: ${String(variant)}`);
  if (!OCC_MILESTONE_STATUSES.includes(status)) throw new RangeError(`Unknown OCC milestone strip status: ${String(status)}`);
  const timeLocale = locale ?? languageLocale;

  if (status === 'empty') {
    return <p data-occ-milestones="empty" className={`text-sm text-occ-muted ${className}`}>{t('milestones.empty')}</p>;
  }

  return (
    <ol aria-label={t('milestones.label')} data-occ-milestones={variant}
      className={`grid gap-x-3 gap-y-3 ${variant === 'compact' ? 'grid-cols-4' : 'grid-cols-1'} ${className}`}>
      {phases.map(phase => (
        <li key={phase.id} data-phase={phase.id} className="min-w-0">
          <p className={PHASE_HEADER[variant]}>
            <span className="font-semibold text-occ-text">{phase.label}</span>{' '}
            <span className="tabular-nums text-occ-muted">{t('milestones.count', { done: phase.done, total: phase.total })}</span>
          </p>
          <span aria-hidden="true" className="mt-1 flex gap-0.5">
            {phase.milestones.map(milestone => (
              <span key={milestone.code} data-tick={milestone.actualAt === null ? 'pending' : 'done'}
                className={`${TICK} ${milestone.actualAt === null ? TICK_PENDING : TICK_DONE}`} />
            ))}
          </span>
          {variant === 'full' ? (
            <ol className="mt-2 flex flex-col gap-1">
              {phase.milestones.map(milestone => (
                <li key={milestone.code} data-milestone={milestone.code}
                  className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 text-occ-text">{milestone.label}</span>{' '}
                  {milestone.actualAt === null
                    ? <span className="shrink-0 text-occ-muted">{t('milestones.pending')}</span>
                    : (
                      <time dateTime={milestone.actualAt} className="shrink-0 font-mono text-occ-text">
                        {formatClock(milestone.actualAt, timeLocale, timeZone)}
                      </time>
                    )}
                </li>
              ))}
            </ol>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
