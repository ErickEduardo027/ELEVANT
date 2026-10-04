'use client';

import dynamic from 'next/dynamic';

const FlightMonitoringRoute = dynamic(() => import('../../../src/features/flight-monitoring/FlightMonitoringRoute'), {
  ssr: false,
  loading: () => <div role="status" className="p-6">Cargando monitoreo de vuelos…</div>,
});

export default function Page() { return <FlightMonitoringRoute />; }
