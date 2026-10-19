import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { XIcon } from '../../shell/components/icons';
import ConsolePanel from './ConsolePanel';
import MapExpandDialog, { ExpandButton } from './MapExpandDialog';

const AirfieldMap = dynamic(() => import('../../maps/AirfieldMap'), { ssr: false });

function RunwayDetail({ t, runway, onClose }) {
  if (runway == null) return null;
  return (
    <div className="absolute bottom-3 left-3 z-10 w-[min(18rem,calc(100%-1.5rem))] rounded-lg border border-occ-line bg-occ-panel p-3 shadow-xl">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-occ-text">
          {runway ? t('airfield.runway', { ref: runway }) : t('airfield.runwayUnnamed')}
        </p>
        <button type="button" onClick={onClose} aria-label={t('map.closeDetail')}
          className="-m-1 flex h-7 w-7 items-center justify-center rounded text-occ-muted hover:bg-occ-panel-muted hover:text-occ-text">
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 text-[11px] text-occ-muted">{t('airfield.runwaySource')}</p>
      <p className="mt-0.5 text-[11px] font-medium text-occ-text">{t('airfield.runwayStatus')}</p>
    </div>
  );
}

// Vista general del aeródromo: pistas, rodajes y plataformas de OpenStreetMap. Seleccionar una
// pista muestra su referencia publicada; el estado operacional queda declarado sin fuente.
export default function AirfieldPanel({ t, theme, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  // null = sin selección; '' = pista sin referencia publicada.
  const [selected, setSelected] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const cameraRef = useRef(null);
  const [camera, setCamera] = useState(null);
  const rememberCamera = next => { cameraRef.current = next; };
  const toggleExpanded = next => {
    setCamera(cameraRef.current);
    setExpanded(next);
  };
  const labels = { unavailableTitle: t('airfield.unavailableTitle'), unavailableBody: t('airfield.unavailableBody') };
  const mapProps = { theme, selectedRunway: selected || null, onSelectRunway: setSelected, initialCamera: camera,
    onCameraChange: rememberCamera, labels };

  return (
    <ConsolePanel className={className} bodyClassName="relative flex flex-col" title={t('airfield.title')}
      meta={<span className="hidden xl:inline">{t('airfield.subtitle')}</span>}
      actions={<ExpandButton label={t('airfield.expand')} onClick={() => toggleExpanded(true)} />}>
      <div className="relative min-h-[200px] flex-1">
        {!expanded && <AirfieldMap {...mapProps} onStatusChange={setGeometry} />}
        {!expanded && <RunwayDetail t={t} runway={selected} onClose={() => setSelected(null)} />}
      </div>
      <p className="border-t border-occ-line px-4 py-2 text-[11px] text-occ-muted">
        {geometry === 'no-geometry' ? t('airfield.noGeometry') : t('airfield.hint')}
      </p>
      {expanded && (
        <MapExpandDialog title={t('airfield.dialogTitle')} note={t('airfield.note')} closeLabel={t('airfield.close')}
          onClose={() => toggleExpanded(false)}>
          <AirfieldMap {...mapProps} />
          <RunwayDetail t={t} runway={selected} onClose={() => setSelected(null)} />
        </MapExpandDialog>
      )}
    </ConsolePanel>
  );
}
