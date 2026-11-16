import { useEffect } from 'react';
import DemoTag from '../../occ-ui/DemoTag';
import { occButtonClass } from '../../occ-ui/OccButton';
import OccPlate from '../../occ-ui/OccPlate';
import { formatClockTime } from '../../dashboard/mappers';
import { XIcon } from '../../shell/components/icons';
import { TERMINAL_LABELS } from '../positionsMapMappers';
import CombinedPositionBanner from './CombinedPositionBanner';
import PositionActions from './PositionActions';
import { useTranslation } from '../../../i18n/LanguageScope';
import StandDetailFacts from '../../maps/ui/StandDetailFacts';
import StandTurnaround from '../../maps/ui/StandTurnaround';
import { positionsMapMessages } from '../positionsMapMessages';

// The inspector of Mapa de posiciones (design E.2, template B): the chosen stand docked at the right of the map, never
// over it, so it covers no stand and the map needs no inset. It is a landmark (`aside`), not a dialog: no veil and no
// focus trap, the map keeps its keys. Esc closes it first and is marked as used, so the next Esc, on the map, leaves the
// selection (contratos 2.2). It keeps the test id and «Cerrar detalle» the cycle E2E closes it with, and the stand's
// facts (maps/ui/StandDetailFacts.jsx), its turnaround with the milestone strip of its flight (maps/ui/
// StandTurnaround.jsx) and the OCC commands («Registrar llegada», «Asignar posición», «Liberar posición», «Ubicar en el
// mapa»).

const CLOSE = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-raised '
  + 'hover:text-occ-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-occ-muted">{label}</dt>
      {/* A missing value reads «—», never an empty line under its label. */}
      <dd className="mt-0.5 font-mono text-sm text-occ-text">{children ?? '—'}</dd>
    </div>
  );
}

export default function PositionDetailDrawer({ position, onClose, onViewFlightInMonitoring, canAssign = false, candidates = [], onChanged,
  onStartPlacing, operationDate, aircraftFacts = null, className = '' }) {
  const { t, locale } = useTranslation(positionsMapMessages);
  useEffect(() => {
    if (!position) return undefined;
    // Escape closes the inspector first and is marked as used, so the map keys leave the selection for the next one.
    // The inspector is docked, not a modal dialog, so the map keys would not wait for it: it listens in the capture
    // phase, before the map's root hears the key, and the map's handler skips a key already used (occShortcuts.js).
    function handleKeyDown(event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [position, onClose]);

  if (!position) return null;

  const hasFlight = Boolean(position.flightId || position.flightNumber);

  return (
    <aside
      data-testid="position-detail-drawer"
      data-occ-inspector="stand"
      aria-label={t('inspector.label', { code: position.id })}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-occ-line bg-occ-panel text-occ-text ${className}`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-occ-line py-2 pl-3 pr-2">
        <div className="min-w-0 space-y-1">
          <h2 id="position-drawer-title" className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            <OccPlate kind="stand" className="text-sm">{position.id}</OccPlate>
            {/* ADR-0041: the flight the stand shows is a demo flight the superadministrator triggered. */}
            {position.isDemo && <DemoTag />}
          </h2>
          {/* No state here: «Estado en el mapa» below says it once, in the words of the map (contracts 2.4). */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-occ-muted">
              {TERMINAL_LABELS[position.terminal] ? t(`terminals.labels.${position.terminal}`) : position.terminal}
            </span>
          </div>
        </div>
        <button type="button" aria-label={t('detail.close')} title={t('detail.close')} onClick={onClose} className={CLOSE}>
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 [scrollbar-width:thin]">
        {/* Its state, why and what comes next, and its characteristics (owner request of 2026-11-15); `aircraftFacts`
            describes the aircraft parked on it or arriving (maps/ui/StandDetailFacts.jsx). */}
        <StandDetailFacts position={position} aircraftFacts={aircraftFacts} />
        {/* The turnaround on the stand, its times, agent, operation and milestones, and the next one (owner request
            of 2026-11-15). */}
        <StandTurnaround position={position} />
        <CombinedPositionBanner position={position} />

        {hasFlight ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Field label={t('detail.flight')}>{position.flightNumber}</Field>
            <Field label={t('detail.airline')}>{position.airline ? <span className="font-sans">{position.airline}</span> : null}</Field>
            <Field label={t('detail.registration')}>{position.aircraftRegistration}</Field>
            <Field label={t('detail.aircraftType')}>{position.aircraftType}</Field>
            <Field label={t('detail.agent')}><span className="font-sans">{position.assignedAgent ?? t('detail.unassigned')}</span></Field>
            <Field label={position.status === 'planned' ? t('detail.releaseUnverified') : t('detail.estimatedRelease')}>
              {position.estimatedReleaseTime ? formatClockTime(position.estimatedReleaseTime, locale) : '—'}
            </Field>
          </dl>
        ) : (
          <p className="text-sm text-occ-muted">{position.status === 'unverified' ? t('detail.unverifiedNote') : t('detail.noFlight')}</p>
        )}

        {canAssign && position.standId && <PositionActions position={position} candidates={candidates} onChanged={onChanged}
          onStartPlacing={onStartPlacing} operationDate={operationDate} />}

        <p className="font-mono text-xs text-occ-muted">
          {t('detail.lastUpdate', { time: position.updatedAt ? formatClockTime(position.updatedAt, locale) : '—' })}
        </p>
      </div>

      {position.flightId && (
        <div className="border-t border-occ-line px-3 py-2">
          <button type="button" onClick={() => onViewFlightInMonitoring(position.flightId)}
            className={`${occButtonClass({ variant: 'secondary', size: 'sm' })} w-full`}>
            {t('detail.viewFlight')}
          </button>
        </div>
      )}
    </aside>
  );
}
