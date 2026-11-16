import { getRampProfiles } from './commercialGovernanceApi';

export async function getHumanResourcesDashboardSnapshot() {
  const catalog = await getRampProfiles();
  const activeProfiles = catalog.profiles.filter(profile => profile.isActive);
  return {
    activeStaffTotal: activeProfiles.length,
    pendingAccounts: activeProfiles.filter(profile => !profile.hasAccount).map(profile => ({
      id: profile.id,
      name: `${profile.firstName} ${profile.lastName}`,
      role: profile.category,
    })),
  };
}
