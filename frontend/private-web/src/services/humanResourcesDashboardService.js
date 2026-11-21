import { getRampProfiles } from './commercialGovernanceApi';

export async function getHumanResourcesDashboardSnapshot() {
  const catalog = await getRampProfiles();
  const activeProfiles = catalog.profiles.filter(profile => profile.isActive);
  return {
    activeStaffTotal: activeProfiles.length,
    // Every profile the account may see, active or not: the whole «activos» is counted against.
    profilesTotal: catalog.profiles.length,
    pendingAccounts: activeProfiles.filter(profile => !profile.hasAccount).map(profile => ({
      id: profile.id,
      name: `${profile.firstName} ${profile.lastName}`,
      role: profile.category,
    })),
  };
}
