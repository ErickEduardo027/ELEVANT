import { getCommercialRequests, getManagedDrafts } from './commercialGovernanceApi';

export async function getContractsHomeSnapshot() {
  const [requests, drafts] = await Promise.all([
    getCommercialRequests(), getManagedDrafts(),
  ]);
  return {
    kpis: {
      pendingRequests: requests.filter(item => ['Pending', 'InReview'].includes(item.status)).length,
      approvedRequests: requests.filter(item => item.status === 'Approved').length,
      pendingDrafts: drafts.length,
      rejectedRequests: requests.filter(item => item.status === 'Rejected').length,
    },
    recentRequests: [...requests].sort((a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()).slice(0, 5),
    pendingDrafts: drafts.slice(0, 5),
  };
}
