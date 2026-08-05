const BASE_SNAPSHOT = {
  kpis: {
    flightsToday: 42,
    servicesPending: 18,
    servicesExecuted: 96,
    agentsActive: 27,
    approvalsPending: 4,
  },
  flyAware: {
    status: 'online',
    lastSyncMinutesAgo: 2,
  },
  flightStatusDistribution: [
    { status: 'scheduled', count: 14 },
    { status: 'enRoute', count: 9 },
    { status: 'landed', count: 11 },
    { status: 'delayed', count: 5 },
    { status: 'diverted', count: 1 },
    { status: 'cancelled', count: 2 },
  ],
  pendingApprovals: [
    {
      id: 'appr-1',
      flightNumber: 'DM161',
      airlineIata: 'DM',
      station: 'PUJ',
      agent: 'J. Ramírez',
      requestedAt: '2026-08-01T13:50:00-04:00',
      status: 'pendingReview',
    },
    {
      id: 'appr-2',
      flightNumber: 'AA904',
      airlineIata: 'AA',
      station: 'PUJ',
      agent: 'M. Castillo',
      requestedAt: '2026-08-01T13:35:00-04:00',
      status: 'pendingReview',
    },
    {
      id: 'appr-3',
      flightNumber: 'DL2210',
      airlineIata: 'DL',
      station: 'PUJ',
      agent: 'R. Peña',
      requestedAt: '2026-08-01T13:10:00-04:00',
      status: 'pendingReview',
    },
    {
      id: 'appr-4',
      flightNumber: 'UA1470',
      airlineIata: 'UA',
      station: 'PUJ',
      agent: 'K. Objío',
      requestedAt: '2026-08-01T12:55:00-04:00',
      status: 'pendingReview',
    },
  ],
  alerts: [
    {
      id: 'alert-1',
      severity: 'warning',
      message: 'Vuelo DM161 no llegó a la posición asignada según hora estimada',
      occurredAt: '2026-08-01T14:20:00-04:00',
    },
    {
      id: 'alert-2',
      severity: 'info',
      message: 'Posición 10 inhabilitada automáticamente por configuración 9-Alfa',
      occurredAt: '2026-08-01T13:58:00-04:00',
    },
    {
      id: 'alert-3',
      severity: 'critical',
      message: 'Vuelo AA904 marcado como desviado por FlyAware',
      occurredAt: '2026-08-01T13:40:00-04:00',
    },
    {
      id: 'alert-4',
      severity: 'warning',
      message: 'Agente K. Objío excede el tiempo estimado de servicio en DL2210',
      occurredAt: '2026-08-01T13:22:00-04:00',
    },
  ],
};

export async function getDashboardSnapshot(stationCode = 'PUJ') {
  return {
    ...BASE_SNAPSHOT,
    station: {
      code: stationCode,
      localAbbr: 'AST',
      localTime: '2026-08-01T14:32:00-04:00',
      utcTime: '2026-08-01T18:32:00Z',
    },
  };
}
