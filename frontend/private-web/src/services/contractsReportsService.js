import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';
import { addDays, businessToday } from './businessDay';
import { getCommercialRequestInbox, getManagedContracts, getManagedDraftOverview } from './commercialGovernanceApi';
import { normalizeServerPage } from '../features/reports/reportModel';

const CONTRACT_PAGE = 50;
// A safety stop: 40 pages of 50 are 2 000 contracts, far above what AVIAM manages.
const MAX_PAGES = 40;
export const EXPIRING_DAYS = 30;

/** Every managed contract, page after page, so the indicators count all of them and not one page. */
async function allContracts() {
  const contracts = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await getManagedContracts(page, CONTRACT_PAGE);
    contracts.push(...result.contracts);
    if (!result.hasMore) return { contracts, complete: true };
  }
  return { contracts, complete: false };
}

/** The version in force of a contract: its approved one, never a superseded one. */
const currentVersion = contract => contract.approvedVersions.find(version => version.status === 'Approved')
  ?? contract.approvedVersions[0] ?? null;

/**
 * The indicators of Contratos › Reportes, with real totals (G3, no «números fríos»): active contracts of all the
 * registered ones, those that end within 30 days, the drafts to activate and the pending requests of all of them.
 */
export async function getContractsReportIndicators({ now = new Date() } = {}) {
  const today = businessToday(now);
  const limit = addDays(today, EXPIRING_DAYS);
  const [{ contracts, complete }, drafts, inbox] = await Promise.all([
    allContracts(), getManagedDraftOverview(), getCommercialRequestInbox({ status: 'All', page: 1, limit: 1 }),
  ]);
  const active = contracts.filter(contract => contract.status === 'Active');
  const expiring = active.map(contract => ({ contract, version: currentVersion(contract) }))
    .filter(({ version }) => version?.validTo && version.validTo >= today && version.validTo <= limit)
    .map(({ contract, version }) => ({ id: contract.id, code: contract.code, airline: contract.airline,
      validTo: version.validTo,
      daysLeft: Math.round((Date.parse(`${version.validTo}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) }))
    .sort((left, right) => left.validTo.localeCompare(right.validTo));
  const counts = inbox.counts;
  return {
    today, limit, complete,
    contracts: contracts.length, active: active.length, expiring,
    drafts: Number(drafts?.count) || 0,
    requests: { pending: counts.pending + counts.inReview, approved: counts.approved,
      total: counts.pending + counts.inReview + counts.approved + counts.rejected + counts.cancelled },
  };
}

/**
 * Whether the API client already has the Contratos reports (a later PR adds them with the common engine). Until then
 * the screen shows only its indicators and no control that cannot act.
 */
export function contractReportsAvailable() {
  try {
    const api = client();
    return ['listContractReports', 'getContractReport', 'exportContractReport'].every(name => typeof api[name] === 'function');
  } catch {
    return false;
  }
}

function client() {
  return createPrivateWebApiClient({ getAccessToken: () => readSession()?.token });
}

/** The adapter of the server's Contratos reports for useServerReport, once the client has them. */
export function createContractReportSource() {
  return {
    baseParams: ['stationId', 'airlineId'],
    loadCatalog: ({ signal } = {}) => client().listContractReports({ signal }),
    loadPage: async (key, query, { signal } = {}) => normalizeServerPage(await client().getContractReport(key, query, { signal })),
    exportReport: (key, query, format) => client().exportContractReport(key, query, format),
    fileName: (key, query, format) => `elevant-contratos-${key}-${query.from}-${query.to}.${format}`,
  };
}

/** The server report behind the list of Contratos › Contratos: each contract with the version that governs it. */
export const CONTRACT_LIST_REPORT = 'agreements';
const LIST_FILTERS = ['airlineId', 'stationId', 'status', 'expiresWithinDays'];

/**
 * «Descargar PDF» / «Descargar Excel» of the list of contracts: the server's «Contratos y vigencias» at today's
 * business-day cut-off with the filters the list has applied (empty ones are left out). The server renders the file.
 */
export async function exportContractsList(format, filters = {}, { now = new Date() } = {}) {
  const today = businessToday(now);
  const query = { from: today, to: today };
  for (const name of LIST_FILTERS) {
    const value = filters?.[name];
    if (value !== undefined && value !== null && value !== '') query[name] = value;
  }
  const blob = await client().exportContractReport(CONTRACT_LIST_REPORT, query, format);
  return { blob, fileName: `elevant-contratos-y-vigencias-${today}.${format}` };
}
