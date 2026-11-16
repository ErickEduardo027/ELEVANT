import OccSkeleton from '../../occ-ui/OccSkeleton';

// The first load of Mapa de posiciones: static blocks where the map and the band will be (occ-ui/OccSkeleton.jsx).
export default function PositionsMapSkeleton() {
  return (
    <div data-testid="positions-map-skeleton" className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-[26rem] flex-1 overflow-hidden rounded-md border border-occ-line bg-occ-panel">
        <OccSkeleton variant="map" />
      </div>
      <div className="h-24 overflow-hidden rounded-md border border-occ-line bg-occ-panel p-3">
        <OccSkeleton rows={2} />
      </div>
    </div>
  );
}
