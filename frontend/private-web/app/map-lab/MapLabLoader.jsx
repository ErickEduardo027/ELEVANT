'use client';

import dynamic from 'next/dynamic';

// The lab draws with WebGL and reads the URL and the clock of the browser: it loads in the browser only.
const MapLab = dynamic(() => import('../../src/features/maps/lab/MapLab'), {
  ssr: false,
  loading: () => (
    <main role="status" data-department="occ" className="dark flex h-screen items-center justify-center bg-occ-canvas text-sm text-occ-muted">
      Cargando el laboratorio de mapas…
    </main>
  ),
});

export default function MapLabLoader() {
  return <MapLab />;
}
