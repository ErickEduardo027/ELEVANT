const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = 45;

const INITIAL_CONTRACTS = [
  { id: 'CTR-2026-018', airline: 'Arajet', airlineCode: 'DM', startDate: '2026-03-01', endDate: '2027-02-28', statusOverride: null, servicesCount: 6, conditions: 'Asistencia en tierra para operaciones regulares en PUJ.' },
  { id: 'CTR-2026-014', airline: 'American Airlines', airlineCode: 'AA', startDate: '2026-01-01', endDate: '2026-12-31', statusOverride: null, servicesCount: 8, conditions: 'Servicios de rampa conforme al itinerario aprobado.' },
  { id: 'CTR-2025-009', airline: 'Delta Air Lines', airlineCode: 'DL', startDate: '2025-09-16', endDate: '2026-09-15', statusOverride: null, servicesCount: 7, conditions: 'Incluye vuelos regulares y operaciones especiales autorizadas.' },
  { id: 'CTR-2025-004', airline: 'JetBlue', airlineCode: 'B6', startDate: '2025-08-23', endDate: '2026-08-22', statusOverride: null, servicesCount: 5, conditions: 'Condiciones operativas registradas para la estación PUJ.' },
  { id: 'CTR-2024-011', airline: 'Air Century', airlineCode: 'Y2', startDate: '2024-07-01', endDate: '2025-06-30', statusOverride: null, servicesCount: 4, conditions: 'Contrato histórico conservado para consulta.' },
  { id: 'CTR-2025-002', airline: 'Sky High', airlineCode: 'DO', startDate: '2025-01-01', endDate: '2026-12-31', statusOverride: 'disabled', servicesCount: 3, conditions: 'Contrato inhabilitado por actualización de condiciones.' },
];

let contracts = INITIAL_CONTRACTS.map(contract => ({ ...contract }));

function todayAtNoon() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
}

export function resolveContractStatus(contract, referenceDate = todayAtNoon()) {
  if (contract.statusOverride === 'disabled') return 'disabled';
  const endDate = new Date(`${contract.endDate}T12:00:00`);
  const daysRemaining = Math.ceil((endDate - referenceDate) / DAY_MS);
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= EXPIRING_WINDOW_DAYS) return 'expiring';
  return 'active';
}

function withStatus(contract) {
  return { ...contract, status: resolveContractStatus(contract) };
}

export async function getContracts() {
  return contracts.map(withStatus);
}

export async function createContract(input) {
  const sequence = contracts.length + 19;
  const contract = {
    id: `CTR-${new Date().getFullYear()}-${String(sequence).padStart(3, '0')}`,
    airline: input.airline.trim(),
    airlineCode: input.airlineCode.trim().toUpperCase(),
    startDate: input.startDate,
    endDate: input.endDate,
    statusOverride: null,
    servicesCount: 0,
    conditions: input.conditions.trim(),
  };
  contracts = [contract, ...contracts];
  return withStatus(contract);
}

export async function updateContract(contractId, changes) {
  let updated = null;
  contracts = contracts.map(contract => {
    if (contract.id !== contractId) return contract;
    updated = {
      ...contract,
      endDate: changes.endDate,
      conditions: changes.conditions.trim(),
      statusOverride: changes.disabled ? 'disabled' : null,
    };
    return updated;
  });
  if (!updated) throw new Error('El contrato solicitado no existe.');
  return withStatus(updated);
}

export function __resetContractsStoreForTests() {
  contracts = INITIAL_CONTRACTS.map(contract => ({ ...contract }));
}
