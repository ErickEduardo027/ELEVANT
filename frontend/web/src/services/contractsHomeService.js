const CONTRACTS_HOME_SNAPSHOT = {
  kpis: {
    activeContracts: 18,
    expiringSoon: 3,
    pendingRequests: 5,
    agreedServices: 42,
  },
  recentContracts: [
    { id: 'CTR-2026-018', airline: 'Arajet', validUntil: '2027-02-28', status: 'active', servicesCount: 6 },
    { id: 'CTR-2026-014', airline: 'American Airlines', validUntil: '2026-12-31', status: 'active', servicesCount: 8 },
    { id: 'CTR-2025-009', airline: 'Delta Air Lines', validUntil: '2026-09-15', status: 'expiring', servicesCount: 7 },
    { id: 'CTR-2025-004', airline: 'JetBlue', validUntil: '2026-08-22', status: 'expiring', servicesCount: 5 },
  ],
  pendingRequests: [
    { id: 'SOL-108', airline: 'Sky High', kind: 'Servicio adicional', receivedAt: '2026-08-09T09:35:00-04:00' },
    { id: 'SOL-107', airline: 'Air Century', kind: 'Afiliación', receivedAt: '2026-08-08T15:10:00-04:00' },
    { id: 'SOL-105', airline: 'Arajet', kind: 'Servicio adicional', receivedAt: '2026-08-08T11:20:00-04:00' },
  ],
};

export async function getContractsHomeSnapshot() {
  return structuredClone(CONTRACTS_HOME_SNAPSHOT);
}
