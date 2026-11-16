'use client';

import { ProtectedRole } from '../../app/auth-boundary';
import { ROLE_KEYS } from '../features/auth/roleRouting';
import { AccessGate, DepartmentAccessProvider } from '../features/access/DepartmentAccessContext';
import AdminOccLayout from '../features/admin-occ/AdminOccLayout';
import { AdminOccPreviewProvider } from '../features/admin-occ/AdminOccPreviewContext';
import { OccBootAccessSignal, OccBootProvider } from '../features/admin-occ/boot/OccBootProvider';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ContractsShell from '../features/contracts/shell/ContractsShell';
import FinanceShell from '../features/finance/shell/FinanceShell';
import GovernanceShell from '../features/governance/GovernanceShell';

const roleKeys = {
  adminOcc: ROLE_KEYS.ADMIN_OCC,
  humanResources: ROLE_KEYS.GESTION_HUMANA,
  contracts: ROLE_KEYS.CONTRATOS,
  finance: ROLE_KEYS.FINANZAS,
  superadmin: ROLE_KEYS.SUPERADMIN,
};

function Shell({ role, user, onLogout, children }) {
  if (role === 'adminOcc') {
    return <AdminOccPreviewProvider><AdminOccLayout user={user} onLogout={onLogout}>{children}</AdminOccLayout></AdminOccPreviewProvider>;
  }
  if (role === 'humanResources') return <HumanResourcesLayout user={user} onLogout={onLogout}>{children}</HumanResourcesLayout>;
  if (role === 'contracts') return <ContractsShell user={user} onLogout={onLogout} />;
  if (role === 'finance') return <FinanceShell user={user} onLogout={onLogout} />;
  return <GovernanceShell user={user} onLogout={onLogout} />;
}

export default function RoleLayout({ role, children }) {
  const layout = (
    <ProtectedRole role={roleKeys[role]}>
      {({ user, onLogout }) => (
        // The OCC shell owns the tab's only account-change observer and refreshes access from it.
        <DepartmentAccessProvider observe={role !== 'adminOcc'}>
          {role === 'adminOcc' ? <OccBootAccessSignal /> : null}
          <AccessGate>
            <Shell role={role} user={user} onLogout={onLogout}>{children}</Shell>
          </AccessGate>
        </DepartmentAccessProvider>
      )}
    </ProtectedRole>
  );
  // The OCC boot screen wraps both gates, so it stays over their two loading screens (contratos 2.6).
  return role === 'adminOcc' ? <OccBootProvider>{layout}</OccBootProvider> : layout;
}
