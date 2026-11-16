'use client';

import { useMemo } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import DemoTag from '../../occ-ui/DemoTag';
import OccDataTable from '../../occ-ui/OccDataTable';
import OccPlate from '../../occ-ui/OccPlate';
import { formatClock, toInstantMs } from '../../occ-ui/occTime';
import { getPlanningStatusMeta } from '../planningStatus';
import { bestLegTime } from '../planningViews';
import { planningMessages } from '../planningMessages';

// «Tabla» of Planificación (design E.2, template C): the day's turnarounds in a dense table (occ-ui/OccDataTable.jsx)
// with the flight, the airline, the best time of each leg with its kind in words, the stand, the agent and the state. A
// row opens the same drawer a flight card opens. Sorted by arrival by default; every column but the agent sorts.

function LegTime({ leg, t, locale, timeZone }) {
  const best = bestLegTime(leg);
  if (!best) return <span className="font-sans text-occ-muted">—</span>;
  return (
    <span className="whitespace-nowrap">
      <time dateTime={new Date(toInstantMs(best.at)).toISOString()}>{formatClock(best.at, locale, timeZone)}</time>{' '}
      <span className="font-sans text-xs text-occ-muted">{t(`table.kinds.${best.kind}`)}</span>
    </span>
  );
}

/** The table. `flights` are the day's turnarounds on screen; `onSelectFlight(id)` opens one; `timeZone` the station's. */
export default function PlanningTable({ flights, onSelectFlight, timeZone = 'UTC', selectedId = null }) {
  const { t, language, locale } = useTranslation(planningMessages);
  const columns = useMemo(() => [
    {
      key: 'flight', header: t('table.flight'), sortable: true, sortValue: flight => flight.flightNumber ?? '',
      render: flight => (
        <span className="inline-flex flex-wrap items-center gap-1">
          <OccPlate kind="flight">{flight.flightNumber ?? flight.operationCode}</OccPlate>
          {flight.isDemo ? <DemoTag /> : null}
        </span>
      ),
    },
    { key: 'airline', header: t('table.airline'), sortable: true, sortValue: flight => flight.airlineName ?? '',
      render: flight => flight.airlineName ?? '—', hideBelow: 'md' },
    {
      key: 'arrival', header: t('table.arrival'), mono: true, sortable: true,
      sortValue: flight => toInstantMs(bestLegTime(flight.arrival)?.at),
      render: flight => <LegTime leg={flight.arrival} t={t} locale={locale} timeZone={timeZone} />,
    },
    {
      key: 'departure', header: t('table.departure'), mono: true, sortable: true,
      sortValue: flight => toInstantMs(bestLegTime(flight.departure)?.at),
      render: flight => <LegTime leg={flight.departure} t={t} locale={locale} timeZone={timeZone} />,
    },
    {
      key: 'stand', header: t('table.stand'), sortable: true, sortValue: flight => flight.stand?.code ?? flight.position,
      render: flight => (flight.stand?.code ?? flight.position
        ? <OccPlate kind="stand">{flight.stand?.code ?? flight.position}</OccPlate>
        : <span className="text-occ-muted">{t('table.noStand')}</span>),
    },
    {
      key: 'agent', header: t('table.agent'), hideBelow: 'lg',
      render: flight => (flight.agents?.length ? flight.agents.join(', ') : <span className="text-occ-muted">{t('table.noAgent')}</span>),
    },
    {
      key: 'state', header: t('table.state'), sortable: true, sortValue: flight => getPlanningStatusMeta(flight.status, language).label,
      render: flight => getPlanningStatusMeta(flight.status, language).label,
    },
  ], [t, language, locale, timeZone]);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-md border border-occ-line bg-occ-panel">
      <OccDataTable caption={t('table.caption')} columns={columns} rows={flights} getRowId={flight => flight.id}
        selectedId={selectedId} onSelectRow={id => onSelectFlight?.(flights.find(flight => String(flight.id) === id)?.id ?? id)}
        rowTestId="planning-table-row"
        scrollClassName="max-h-[calc(100dvh-22rem)] min-h-[12rem] [scrollbar-width:thin]" />
    </div>
  );
}
