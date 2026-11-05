import { getApprovedServices } from './approvedServicesService';
import { getFinancePreinvoices } from './financePreinvoiceService';

const ACTIONS = {
  Draft: 'Preparar envío a la aerolínea',
  Disputed: 'Resolver disputa de la aerolínea',
  Accepted: 'Emitir factura de prueba',
};

export async function getFinanceHomeSnapshot({ stationId, from, to }, { signal } = {}) {
  const [evidence, page] = await Promise.all([
    getApprovedServices({ stationId, from, to }, { signal }),
    getFinancePreinvoices({ stationId, page: 1, limit: 50 }, { signal }),
  ]);
  const services = evidence.services;
  const preinvoices = page.preinvoices;

  return {
    kpis: {
      approvedServices: services.length,
      readyForPreinvoice: services.filter(item => item.ready && !item.preinvoiceId).length,
      draftPreinvoices: preinvoices.filter(item => item.status === 'Draft').length,
      disputedPreinvoices: preinvoices.filter(item => item.status === 'Disputed').length,
    },
    bounds: { servicesHaveMore: evidence.hasMore, preinvoicesHaveMore: page.hasMore },
    approvedServices: services.slice(0, 5).map(item => ({
      id: item.id,
      airline: item.airlineName,
      flight: item.flightNumber,
      service: item.serviceName,
      operationDate: item.operationDate,
      amount: item.amount,
      currency: item.frozenCurrency,
    })),
    pendingActions: preinvoices.filter(item => ACTIONS[item.status]).slice(0, 5)
      .map(item => ({
        id: item.id,
        kind: 'Pre-factura',
        airline: item.airlineName,
        detail: ACTIONS[item.status],
        moduleId: 'finance-to-invoice',
      })),
  };
}
