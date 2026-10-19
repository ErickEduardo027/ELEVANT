import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import ConsolePanel from './ConsolePanel';
import MapExpandDialog, { ExpandButton } from './MapExpandDialog';

const RegionalTrafficMap = dynamic(() => import('../../maps/RegionalTrafficMap'), { ssr: false });

const known = value => value == null || value === '' ? '—' : value;
const utc = value => value && !Number.isNaN(Date.parse(value))
  ? `${new Date(value).toISOString().slice(11, 16)} UTC` : '—';

function AircraftDetails({ t, item, onClose }) {
  const fields = [
    ['icao24', item.icao24], ['country', item.originCountry],
    ['coordinates', `${item.latitude.toFixed(3)}°, ${item.longitude.toFixed(3)}°`],
    ['barometricAltitude', item.barometricAltitudeMeters == null ? null : `${Math.round(item.barometricAltitudeMeters)} m`],
    ['geometricAltitude', item.geometricAltitudeMeters == null ? null : `${Math.round(item.geometricAltitudeMeters)} m`],
    ['speed', item.groundSpeedMetersPerSecond == null ? null : `${Math.round(item.groundSpeedMetersPerSecond)} m/s`],
    ['track', item.trueTrackDegrees == null ? null : `${Math.round(item.trueTrackDegrees)}°`],
    ['verticalRate', item.verticalRateMetersPerSecond == null ? null : `${item.verticalRateMetersPerSecond.toFixed(1)} m/s`],
    ['surfaceReport', item.onGround ? t('traffic.yes') : t('traffic.no')],
    ['squawk', item.squawk], ['category', item.category],
    ['lastPosition', utc(item.lastPositionAt)], ['lastContact', utc(item.lastContactAt)],
  ];
  return <div className="absolute bottom-3 left-3 right-3 z-20 max-h-[65%] overflow-auto rounded-lg border border-occ-line-strong bg-occ-panel/95 p-3 text-occ-text shadow-xl backdrop-blur-xl sm:right-auto sm:w-80">
    <div className="flex items-start justify-between gap-2">
      <div><p className="text-sm font-bold">{item.callsign || item.icao24}</p>
        <p className="text-[10px] text-occ-muted">{t('traffic.telemetryOnly')}</p></div>
      <button type="button" onClick={onClose} aria-label={t('traffic.closeDetail')}
        className="rounded border border-occ-line px-2 py-0.5 text-xs text-occ-text">×</button>
    </div>
    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
      {fields.map(([key, value]) => <div key={key} className="min-w-0">
        <dt className="text-occ-muted">{t(`traffic.field.${key}`)}</dt>
        <dd className="break-words font-mono">{known(value)}</dd>
      </div>)}
    </dl>
  </div>;
}

function TrafficStatus({ t, traffic }) {
  const count = traffic?.data?.aircraft?.length ?? 0;
  const message = traffic?.status === 'loading' ? t('traffic.loading')
    : traffic?.status === 'forbidden' ? t('traffic.forbidden')
      : traffic?.status === 'unauthorized' ? t('traffic.unauthorized')
        : traffic?.status === 'error' ? t('traffic.error')
          : !count ? t('traffic.empty')
            : traffic.data.stale ? t('traffic.stale') : t('traffic.count', { count });
  return <p role={traffic?.status === 'error' ? 'alert' : 'status'}
    className="absolute bottom-3 left-3 z-10 max-w-[min(20rem,calc(100%-1.5rem))] rounded-md border border-occ-line bg-occ-panel/95 p-2.5 text-xs text-occ-text shadow-sm backdrop-blur-lg">
    {message}
  </p>;
}

export default function RegionalTrafficPanel({ t, theme, traffic, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIcao24, setSelectedIcao24] = useState(null);
  const cameraRef = useRef(null);
  const [camera, setCamera] = useState(null);
  const labels = { centerPuj: t('traffic.centerPuj'), resetRegion: t('traffic.resetRegion'),
    unavailable: t('traffic.unavailable'), aircraft: t('traffic.aircraft') };
  const aircraft = traffic?.data?.aircraft ?? [];
  const selected = aircraft.find(item => item.icao24 === selectedIcao24);
  useEffect(() => { if (selectedIcao24 && !selected) setSelectedIcao24(null); }, [selected, selectedIcao24]);
  const mapProps = { theme, initialCamera: camera, onCameraChange: next => { cameraRef.current = next; },
    labels, aircraft, selectedIcao24, onSelectAircraft: setSelectedIcao24 };
  const toggleExpanded = next => { setCamera(cameraRef.current); setExpanded(next); };
  const source = traffic?.data ? `${t('traffic.source')} · ${t('traffic.providerTime', { time: utc(traffic.data.providerTime) })}`
    : t('traffic.sourceMap');

  return <ConsolePanel className={`occ-dashboard-map-panel ${className}`} bodyClassName="relative flex flex-col" title={t('traffic.title')}
    actions={<ExpandButton label={t('traffic.expand')} onClick={() => toggleExpanded(true)} />}>
    <div className="relative min-h-[210px] flex-1">
      {!expanded && <RegionalTrafficMap {...mapProps} />}
      {!expanded && (selected ? <AircraftDetails t={t} item={selected} onClose={() => setSelectedIcao24(null)} />
        : <TrafficStatus t={t} traffic={traffic} />)}
    </div>
    <p className="border-t border-occ-line px-4 py-2 text-[11px] text-occ-muted">{source}</p>
    {expanded && <MapExpandDialog title={t('traffic.dialogTitle')} note={source}
      closeLabel={t('traffic.close')} onClose={() => toggleExpanded(false)}>
      <RegionalTrafficMap {...mapProps} />
      {selected ? <AircraftDetails t={t} item={selected} onClose={() => setSelectedIcao24(null)} />
        : <TrafficStatus t={t} traffic={traffic} />}
    </MapExpandDialog>}
  </ConsolePanel>;
}
