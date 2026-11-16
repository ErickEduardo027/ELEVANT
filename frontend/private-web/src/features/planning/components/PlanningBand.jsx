'use client';

import { useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { businessToday } from '../../../services/businessDay';
import { bandWindow } from '../../dashboard/noc/standTimeline';
import OccSegmented from '../../occ-ui/OccSegmented';
import OccTimeline from '../../occ-ui/OccTimeline';
import { planningBandRows, planningBandWindow } from '../planningViews';
import { planningMessages } from '../planningMessages';

// «Posiciones» of Planificación (design E.2, template C): the stand band of the day (occ-ui/OccTimeline.jsx), one row
// per stand with planned visits and the «ahora» line, from the planning snapshot alone. On the station's today it opens
// on «8 h» around now (two hours back, six ahead), where the bars are readable; «Día» shows the whole day, and another
// day always shows whole. A bar opens the turnaround's drawer, as its flight card does.

const RANGES = Object.freeze(['4h', '8h', 'day']);

/** The band. `flights` are the day's turnarounds on screen, `date` the operating day, `now` an instant. */
export default function PlanningBand({ flights, date, now, timeZone = 'UTC', onSelectFlight, selectedId = null }) {
  const { t } = useTranslation(planningMessages);
  const [range, setRange] = useState('8h');
  const nowMs = Date.parse(now);
  const today = Number.isFinite(nowMs) && date === businessToday(new Date(nowMs), timeZone);
  const rows = useMemo(() => planningBandRows(flights), [flights]);
  const window = useMemo(() => (today && range !== 'day' ? bandWindow(range, nowMs, timeZone)
    : planningBandWindow(rows, date, timeZone)), [today, range, nowMs, timeZone, rows, date]);
  return (
    <section aria-label={t('band.label')} className="flex min-h-0 flex-col rounded-md border border-occ-line bg-occ-panel">
      {today ? (
        <div className="flex justify-end border-b border-occ-line px-3 py-2">
          <OccSegmented label={t('band.rangeLabel')} size="sm" value={range} onChange={setRange}
            options={RANGES.map(id => ({ id, label: t(`band.ranges.${id}`) }))} />
        </div>
      ) : null}
      <div className="max-h-[calc(100dvh-24rem)] min-h-[12rem] overflow-auto p-2 [scrollbar-width:thin]">
        {rows.length === 0 || window === null ? <p className="px-1 py-2 text-sm text-occ-muted">{t('band.empty')}</p> : (
          <OccTimeline label={t('band.label')} rows={rows} windowStart={window.windowStart} windowEnd={window.windowEnd}
            now={Number.isFinite(nowMs) ? nowMs : null} timeZone={timeZone}
            selectedBarId={selectedId === null ? null : String(selectedId)}
            onSelectBar={bar => onSelectFlight?.(bar.turnaroundId)} />
        )}
      </div>
    </section>
  );
}
