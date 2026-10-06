'use client';

import dynamic from 'next/dynamic';

const PositionsMapRoute = dynamic(() => import('../../../src/features/positions-map/PositionsMapRoute'), {
  ssr: false,
  loading: () => <div role="status" className="p-6">Cargando mapa de posiciones…</div>,
});

export default function Page() { return <PositionsMapRoute />; }
