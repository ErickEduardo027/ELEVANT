const SERVICES = [
  { id: 'SRV-2608-041', airline: 'Arajet', flight: 'DM 1763', date: '2026-08-10', service: 'Puente de abordaje', contract: 'CTR-2026-018', amount: 18500, currency: 'DOP', status: 'pending' },
  { id: 'SRV-2608-039', airline: 'American Airlines', flight: 'AA 2401', date: '2026-08-10', service: 'GPU', contract: 'CTR-2026-014', amount: 325, currency: 'USD', status: 'reviewed' },
  { id: 'SRV-2608-035', airline: 'Delta Air Lines', flight: 'DL 1826', date: '2026-08-09', service: 'Aire acondicionado', contract: 'CTR-2025-009', amount: 280, currency: 'USD', status: 'pending' },
  { id: 'SRV-2608-031', airline: 'JetBlue', flight: 'B6 1015', date: '2026-08-09', service: 'Puente de abordaje', contract: 'CTR-2025-004', amount: 310, currency: 'USD', status: 'reviewed' },
];

let services = structuredClone(SERVICES);

function usesPrototypeApi() { return import.meta.env.MODE !== 'test'; }

async function financeApi(path, options = {}) {
  const session = readSession();
  const response = await fetch(`${PROTOTYPE_API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  handleUnauthorizedResponse(response);
  if (!response.ok) throw new Error(payload.error || 'No se pudieron cargar los servicios aprobados.');
  return payload;
}

export async function getApprovedServices() {
  if (usesPrototypeApi()) return financeApi('/api/finance/approved-services');
  return structuredClone(services);
}

export async function markApprovedServiceReviewed(id) {
  if (usesPrototypeApi()) return financeApi(`/api/finance/approved-services/${encodeURIComponent(id)}/review`, { method: 'POST' });
  const service = services.find(item => item.id === id);
  if (!service) throw new Error('Servicio aprobado no encontrado.');
  service.status = 'reviewed';
  service.reviewedAt = new Date().toISOString();
  return structuredClone(service);
}

export function resetApprovedServicesForTests() {
  services = structuredClone(SERVICES);
}
import { handleUnauthorizedResponse, PROTOTYPE_API_URL, readSession } from '../features/auth/authService';
