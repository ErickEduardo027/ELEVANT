import { commercialApi } from './commercialGovernanceApi';
export const getPreinvoiceCalculations = id => commercialApi('/finance/preinvoices/' + id + '/calculations');
const post = (id, action, input) => commercialApi('/finance/preinvoices/' + id + '/' + action, { method: 'POST', body: JSON.stringify(input) });
export const cancelDraft = (id, input) => post(id, 'cancel', input);
export const restoreDraftCalculation = (id, input) => post(id, 'restore-calculation', input);
