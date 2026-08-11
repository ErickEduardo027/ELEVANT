const INITIAL_SERVICES = [
  { id: 'SRV-001', contractId: 'CTR-2026-018', airline: 'Arajet', name: 'Puente de abordaje', rate: 485, currency: 'USD', billingUnit: 'Por operación', startDate: '2026-03-01', endDate: '2027-02-28', active: true },
  { id: 'SRV-002', contractId: 'CTR-2026-018', airline: 'Arajet', name: 'GPU', rate: 220, currency: 'USD', billingUnit: 'Por hora', startDate: '2026-03-01', endDate: '2027-02-28', active: true },
  { id: 'SRV-003', contractId: 'CTR-2026-014', airline: 'American Airlines', name: 'Manejo de equipaje', rate: 740, currency: 'USD', billingUnit: 'Por operación', startDate: '2026-01-01', endDate: '2026-12-31', active: true },
  { id: 'SRV-004', contractId: 'CTR-2026-014', airline: 'American Airlines', name: 'Limpieza de cabina', rate: 310, currency: 'USD', billingUnit: 'Por operación', startDate: '2026-01-01', endDate: '2026-12-31', active: true },
  { id: 'SRV-005', contractId: 'CTR-2025-009', airline: 'Delta Air Lines', name: 'Aire acondicionado', rate: 185, currency: 'USD', billingUnit: 'Por hora', startDate: '2025-09-16', endDate: '2026-09-15', active: true },
  { id: 'SRV-006', contractId: 'CTR-2025-004', airline: 'JetBlue', name: 'Escalera de pasajeros', rate: 275, currency: 'USD', billingUnit: 'Por operación', startDate: '2025-08-23', endDate: '2026-08-22', active: false },
];

let services = INITIAL_SERVICES.map(service => ({ ...service }));

export async function getContractServices() {
  return services.map(service => ({ ...service }));
}

export async function createContractService(input) {
  const service = {
    id: `SRV-${String(services.length + 1).padStart(3, '0')}`,
    contractId: input.contractId,
    airline: input.airline,
    name: input.name.trim(),
    rate: Number(input.rate),
    currency: input.currency,
    billingUnit: input.billingUnit,
    startDate: input.startDate,
    endDate: input.endDate,
    active: true,
  };
  services = [service, ...services];
  return { ...service };
}

export async function updateContractService(serviceId, changes) {
  let updated = null;
  services = services.map(service => {
    if (service.id !== serviceId) return service;
    updated = {
      ...service,
      rate: Number(changes.rate),
      currency: changes.currency,
      billingUnit: changes.billingUnit,
      endDate: changes.endDate,
      active: changes.active,
    };
    return updated;
  });
  if (!updated) throw new Error('El servicio pactado no existe.');
  return { ...updated };
}

export function __resetContractServicesStoreForTests() {
  services = INITIAL_SERVICES.map(service => ({ ...service }));
}
