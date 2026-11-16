'use client';

import { useMemo } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { standStateOf } from '../../maps/stands/standModel';
import DemoTag from '../../occ-ui/DemoTag';
import OccDataTable from '../../occ-ui/OccDataTable';
import OccEmptyState from '../../occ-ui/OccEmptyState';
import OccPlate from '../../occ-ui/OccPlate';
import OccStandSwatch from '../../occ-ui/OccStandSwatch';
import { STAND_STATES } from '../../occ-ui/statusVocabulary';
import { mapMessages } from '../../maps/mapMessages';
import { positionsMapMessages } from '../positionsMapMessages';

// «Lista de posiciones» of Mapa de posiciones (design E.2, template B): the stands as a dense table (occ-ui/OccDataTable)
// with the stand code, its terminal, the state the map draws (its shape and its word, contratos 2.4), the flight on it
// and who covers it. A row chooses its stand (the one selection of the URL, `stand=`). Each row keeps the test id the
// page tests and the cycle E2E find a stand by, `position-list-item`; the panel keeps `positions-side-panel`.

const REASONS = Object.freeze(['no-positions', 'no-results']);

/** Who covers a stand: the board's coverage, else the agent of its flight; `null` without either. */
export function standAgentOf(position) {
  if (Array.isArray(position?.coveredBy) && position.coveredBy.length > 0) return position.coveredBy.join(', ');
  return position?.assignedAgent ?? null;
}

/**
 * The table. `positions` are the stands on screen (filtered by terminal and search, with their display state);
 * `emptyReason` is `no-positions` or `no-results` when there is none; `selectedPositionId` is the chosen stand and
 * `onSelectPosition(id)` chooses one.
 */
export default function PositionsTable({ positions, emptyReason = null, selectedPositionId = null, onSelectPosition,
  className = '' }) {
  const { t, language } = useTranslation(positionsMapMessages);
  const { t: tMap } = useTranslation(mapMessages);

  const columns = useMemo(() => [
    {
      key: 'code', header: t('table.code'), width: '5.5rem',
      render: position => (
        <span className="flex flex-wrap items-center gap-1">
          <OccPlate kind="stand">{position.id}</OccPlate>
          {/* A stand of the board the map does not draw: «Ubicar en el mapa» in its inspector places it. */}
          {position.locationSource === 'none'
            ? <span data-location="none" className="text-xs text-occ-muted">{tMap('stand.unlocated')}</span>
            : null}
        </span>
      ),
    },
    {
      key: 'terminal', header: t('table.terminal'), width: '4.25rem',
      render: position => (position.terminal === 'FBO' ? 'FBO' : position.terminal ?? '—'),
    },
    {
      key: 'state', header: t('table.state'),
      render: position => {
        const state = standStateOf(position);
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <OccStandSwatch state={state} />
            {STAND_STATES[state][language]}
          </span>
        );
      },
    },
    {
      key: 'flight', header: t('table.flight'), mono: true,
      render: position => (position.flightNumber ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          {position.flightNumber}
          {position.isDemo ? <DemoTag /> : null}
        </span>
      ) : (
        // A dash on screen; the words for a screen reader.
        <span className="font-sans text-occ-muted"><span aria-hidden="true">—</span><span className="sr-only">{t('list.noFlight')}</span></span>
      )),
    },
    {
      // Only from 1536 px, where the list is wide enough to give it a column (the inspector names the agent anyway).
      key: 'agent', header: t('table.agent'), hideBelow: '2xl',
      render: position => standAgentOf(position) ?? <span className="text-occ-muted">{t('detail.unassigned')}</span>,
    },
  ], [t, tMap, language]);

  const reason = REASONS.includes(emptyReason) ? emptyReason : 'no-positions';
  return (
    <section data-testid="positions-side-panel" aria-label={t('list.drawer')}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-occ-line bg-occ-panel ${className}`}>
      <OccDataTable caption={t('list.drawer')} columns={columns} rows={emptyReason ? [] : positions}
        getRowId={position => position.id} selectedId={selectedPositionId}
        onSelectRow={id => onSelectPosition?.(id)} rowTestId="position-list-item" stackBelow={false}
        emptyState={<OccEmptyState title={t(`empty.${reason}.title`)} description={t(`empty.${reason}.description`)}
          className="p-4" />}
        className="flex min-h-0 flex-1 flex-col" scrollClassName="min-h-0 flex-1 [scrollbar-width:thin]" />
    </section>
  );
}
