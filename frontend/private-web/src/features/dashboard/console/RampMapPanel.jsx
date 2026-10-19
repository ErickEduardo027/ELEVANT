import { useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { AIP_PARKING_CHART_URL, AIP_AMENDMENT_URL, DASHBOARD_POSITIONS, RETIRED_DASHBOARD_POSITIONS, unlocatedStandAssignments } from '../dashboardPositions';
import { mapTurnaroundsToRampPositions } from '../../positions-map/positionsMapMappers';
import { ChevronRightIcon, XIcon } from '../../shell/components/icons';
import AircraftSilhouetteIcon from '../../maps/AircraftSilhouetteIcon';
import ConsolePanel, { PanelLink } from './ConsolePanel';
import MapExpandDialog, { ExpandButton } from './MapExpandDialog';

// MapLibre necesita `window`: igual que la ruta de posiciones, se carga solo en cliente.
const PositionMap = dynamic(() => import('../../positions-map/components/PositionMap'), { ssr: false });

function Legend({ t, plannedCount }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-occ-muted">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-dashed border-[#145DC4] bg-white">
          <AircraftSilhouetteIcon className="h-3 w-3" fill="#145DC4" />
        </span>
        {t('map.planned')} <span className="font-mono text-occ-text">({plannedCount})</span>
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="relative inline-block h-4 w-4 rounded-[3px] border border-[#7C8A9E] bg-[#7C8A9E]/15">
          <span className="absolute inset-x-1/2 inset-y-[3px] w-px -translate-x-1/2 bg-[#7C8A9E]" />
        </span>
        {t('map.unverified')}
      </li>
      <li className="text-[10.5px]">{t('map.source')}{' · '}
        <a href={AIP_PARKING_CHART_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">{t('map.chartShort')}</a>
      </li>
    </ul>
  );
}

function TurnaroundList({ t, turnarounds }) {
  if (!turnarounds.length) return null;
  return (
    <ul className="mt-2 divide-y divide-occ-line text-xs">
      {turnarounds.map(item => (
        <li key={item.id} className="py-1.5">
          <span className="font-mono font-semibold text-occ-text">{item.operationCode}</span>
          <span className="ml-2 text-occ-muted">{item.airline}</span>
          <span className="mt-0.5 block font-mono text-occ-muted">
            {item.arrivalFlight ?? t('board.noArrival')} → {item.departureFlight ?? t('board.noDeparture')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StandDetail({ t, position, onClose }) {
  if (!position) return null;
  return (
    <div className="absolute bottom-3 left-3 z-10 w-[min(20rem,calc(100%-1.5rem))] rounded-lg border border-occ-line bg-occ-panel p-3 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-occ-text">{t('map.stand', { id: position.id })}</p>
          <p className="text-[11px] text-occ-muted">
            {position.plannedTurnarounds.length
              ? t('map.turnaroundsAt', { count: position.plannedTurnarounds.length })
              : t('map.unverified')}
            {' · '}{t('map.internalLocation')}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('map.closeDetail')}
          className="-m-1 flex h-7 w-7 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-muted hover:text-occ-text">
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <TurnaroundList t={t} turnarounds={position.plannedTurnarounds} />
      <a href={AIP_PARKING_CHART_URL} target="_blank" rel="noreferrer"
        className="mt-2 inline-block text-[11px] text-occ-accent underline underline-offset-2">
        {t('map.chartReference')}
      </a>
      <p className="mt-2 text-[10.5px] text-occ-muted">{t('map.note')}</p>
    </div>
  );
}

function StandList({ t, positions, unlocated, selectedId, onSelect }) {
  return <>
    <p className="sticky top-0 border-b border-occ-line bg-occ-panel px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-occ-muted">
      {t('map.stands')} · <span className="font-mono">{positions.length}</span>
    </p>
    {positions.length === 0
      ? <p className="px-4 py-6 text-sm text-occ-muted">{t('map.noStands')}</p>
      : <ul className="divide-y divide-occ-line">
        {positions.map(position => (
          <li key={position.id}>
            <button type="button" aria-pressed={position.id === selectedId} onClick={() => onSelect(position.id)}
              className={`flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-occ-panel-muted ${
                position.id === selectedId ? 'bg-occ-accent-soft' : ''}`}>
              <span className="w-10 shrink-0 font-mono text-sm font-semibold text-occ-text">{position.id}</span>
              <span className="min-w-0 flex-1 text-xs text-occ-muted">
                {position.plannedTurnarounds.length ? position.plannedTurnarounds.map(item => item.operationCode).join(' · ') : t('map.unverified')}
              </span>
              <ChevronRightIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-occ-muted" />
            </button>
          </li>
        ))}
      </ul>}
    <p className="border-y border-occ-line bg-occ-panel-muted px-4 py-2 text-[11px] text-occ-muted">
      {t('map.retiredHistorical', { code: RETIRED_DASHBOARD_POSITIONS[0].id })}{' · '}
      <a href={AIP_AMENDMENT_URL} target="_blank" rel="noreferrer" className="underline">{t('map.amendmentReference')}</a>
    </p>
    {unlocated.length > 0 && <>
      <p className="border-y border-occ-line bg-occ-panel-muted px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-occ-muted">
        {t('map.unlocatedTitle', { count: unlocated.length })}
      </p>
      <ul className="divide-y divide-occ-line text-xs">
        {unlocated.map(({ code, assignments }) => <li key={code} className="px-4 py-2">
          <span className="font-mono font-semibold text-occ-text">{code}</span>
          <span className="ml-2 text-occ-muted">{assignments.map(item => item.operationCode).join(' · ')}</span>
        </li>)}
      </ul>
    </>}
  </>;
}

// Plataforma de PUJ: stands como ubicaciones fijas y, cuando una escala los tiene asignados,
// la silueta en estilo "planificado". La vista ampliada comparte selección y cámara.
export default function RampMapPanel({ t, theme, turnarounds, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [viewModeOverride, setViewModeOverride] = useState(null);
  const viewMode = viewModeOverride ?? (theme === 'dark' ? '3d' : '2d');
  // La cámara se recuerda en un ref mientras el usuario navega y se fija en estado al abrir o
  // cerrar la vista ampliada, para que cada mapa arranque donde quedó el otro.
  const cameraRef = useRef(null);
  const [camera, setCamera] = useState(null);
  const expandedMapRef = useRef(null);
  const positions = useMemo(() => mapTurnaroundsToRampPositions(DASHBOARD_POSITIONS, turnarounds),
    [turnarounds]);
  const planned = useMemo(() => positions.filter(item => item.plannedTurnarounds.length > 0), [positions]);
  const unlocated = useMemo(() => unlocatedStandAssignments(turnarounds), [turnarounds]);
  const selected = positions.find(item => item.id === selectedId) ?? null;
  const rememberCamera = next => { cameraRef.current = next; };
  const toggleExpanded = next => {
    setCamera(cameraRef.current);
    setExpanded(next);
  };

  return (
    <ConsolePanel className={`occ-dashboard-map-panel ${className}`} bodyClassName="relative flex flex-col"
      title={t('map.title')}
      meta={<span className="hidden sm:inline">{t('map.subtitle')}</span>}
      actions={<>
        <button type="button" aria-pressed={viewMode === '3d'} onClick={() => setViewModeOverride(viewMode === '3d' ? '2d' : '3d')}
          className="h-8 rounded-md border border-occ-line px-2.5 text-xs font-semibold text-occ-text hover:border-occ-line-strong">
          {viewMode === '3d' ? t('map.view2d') : t('map.view3d')}
        </button>
        <PanelLink href="/admin-occ/positions-map">{t('map.openPositions')}</PanelLink>
        <ExpandButton label={t('map.expand')} onClick={() => toggleExpanded(true)} />
      </>}>
      <div className="relative min-h-[260px] flex-1">
        {!expanded && <PositionMap positions={positions} selectedPositionId={selectedId}
          onSelectPosition={setSelectedId} theme={theme} viewMode={viewMode} allowBuildingExtrusion dashboardLabels
          initialCamera={camera} onCameraChange={rememberCamera} />}
        {!expanded && <StandDetail t={t} position={selected} onClose={() => setSelectedId(null)} />}
      </div>
      <div className="border-t border-occ-line px-4 py-2">
        <Legend t={t} plannedCount={planned.length} />
        {unlocated.length > 0 && <p className="mt-1 text-[10.5px] text-occ-muted">{t('map.unlocatedTitle', { count: unlocated.length })}</p>}
      </div>
      {expanded && (
        <MapExpandDialog title={t('map.dialogTitle')} note={t('map.note')} closeLabel={t('map.close')}
          onClose={() => toggleExpanded(false)}
          aside={<StandList t={t} positions={positions} unlocated={unlocated} selectedId={selectedId}
            onSelect={id => { setSelectedId(id); expandedMapRef.current?.flyToPosition(id); }} />}>
          <PositionMap ref={expandedMapRef} positions={positions} selectedPositionId={selectedId}
            onSelectPosition={setSelectedId} theme={theme} viewMode={viewMode} allowBuildingExtrusion dashboardLabels
            initialCamera={camera} onCameraChange={rememberCamera} />
          <StandDetail t={t} position={selected} onClose={() => setSelectedId(null)} />
        </MapExpandDialog>
      )}
    </ConsolePanel>
  );
}
