import { getFinancePreinvoices } from './financePreinvoiceService';

const STATUS_KEYS = {
  Draft: 'drafts', Submitted: 'submitted', Disputed: 'disputed',
  Accepted: 'accepted', Invoiced: 'invoiced', Voided: 'voided',
};

function emptyCounts() {
  return { drafts: 0, submitted: 0, disputed: 0,
    accepted: 0, invoiced: 0, voided: 0 };
}

export async function getFinanceReport({ stationId }, { signal } = {}) {
  const page = await getFinancePreinvoices({ stationId, page: 1, limit: 50 }, { signal });
  const counts = emptyCounts();
  const groups = new Map();
  for (const item of page.preinvoices) {
    const key = STATUS_KEYS[item.status];
    if (key) counts[key] += 1;
    const groupKey = `${item.airlineId}|${item.currencyCode}`;
    if (!groups.has(groupKey)) groups.set(groupKey, {
      airlineId: item.airlineId, airlineName: item.airlineName,
      currencyCode: item.currencyCode, ...emptyCounts(),
    });
    if (key) groups.get(groupKey)[key] += 1;
  }
  return { counts, hasMore: page.hasMore,
    rows: [...groups.values()].sort((a, b) =>
      a.airlineName.localeCompare(b.airlineName) ||
      a.currencyCode.localeCompare(b.currencyCode)) };
}
