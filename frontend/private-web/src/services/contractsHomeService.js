import { getCommercialRequestInbox, getManagedDraftOverview } from './commercialGovernanceApi';

const RECENT_REQUESTS = 5;

/**
 * Contratos overview. The request indicators are the inbox counters of every request, not a
 * count over a truncated list (1-N23); the recent list is the latest page of all statuses.
 */
export async function getContractsHomeSnapshot() {
  const [inbox, drafts] = await Promise.all([
    getCommercialRequestInbox({ status: 'All', page: 1, limit: RECENT_REQUESTS }), getManagedDraftOverview(),
  ]);
  return {
    kpis: {
      pendingRequests: inbox.counts.pending + inbox.counts.inReview,
      approvedRequests: inbox.counts.approved,
      pendingDrafts: drafts.count,
      rejectedRequests: inbox.counts.rejected,
    },
    recentRequests: inbox.requests,
    pendingDrafts: drafts.recent,
  };
}
