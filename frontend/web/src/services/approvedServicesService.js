const SERVICES = [
  { id: 'SRV-2608-041', airline: 'Arajet', flight: 'DM 1763', date: '2026-08-10', service: 'Puente de abordaje', contract: 'CTR-2026-018', amount: 18500, currency: 'DOP', status: 'pending' },
  { id: 'SRV-2608-039', airline: 'American Airlines', flight: 'AA 2401', date: '2026-08-10', service: 'GPU', contract: 'CTR-2026-014', amount: 325, currency: 'USD', status: 'reviewed' },
  { id: 'SRV-2608-035', airline: 'Delta Air Lines', flight: 'DL 1826', date: '2026-08-09', service: 'Aire acondicionado', contract: 'CTR-2025-009', amount: 280, currency: 'USD', status: 'pending' },
  { id: 'SRV-2608-031', airline: 'JetBlue', flight: 'B6 1015', date: '2026-08-09', service: 'Puente de abordaje', contract: 'CTR-2025-004', amount: 310, currency: 'USD', status: 'reviewed' },
];

let services = structuredClone(SERVICES);

export async function getApprovedServices() {
  return structuredClone(services);
}

export async function markApprovedServiceReviewed(id) {
  const service = services.find(item => item.id === id);
  if (!service) throw new Error('Servicio aprobado no encontrado.');
  service.status = 'reviewed';
  service.reviewedAt = new Date().toISOString();
  return structuredClone(service);
}

export function resetApprovedServicesForTests() {
  services = structuredClone(SERVICES);
}
