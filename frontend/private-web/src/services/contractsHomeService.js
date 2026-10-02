import { getCommercialRequests, getManagedDraftOverview } from './commercialGovernanceApi';

export async function getContractsHomeSnapshot() {
  const [requests, drafts] = await Promise.all([
    getCommercialRequests(), getManagedDraftOverview(),
  ]);
  return {
    kpis: {
      pendingRequests: requests.filter(item => ['Pending', 'InReview'].includes(item.status)).length,
      approvedRequests: requests.filter(item => item.status === 'Approved').length,
      pendingDrafts: drafts.count,
      rejectedRequests: requests.filter(item => item.status === 'Rejected').length,
    },
    recentRequests: [...requests].sort((a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()).slice(0, 5),
    pendingDrafts: drafts.recent,
  };
}
