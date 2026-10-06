'use client';

import { ProtectedRole } from '../../app/auth-boundary';
import { ROLE_KEYS } from '../features/auth/roleRouting';
import AdminOccLayout from '../features/admin-occ/AdminOccLayout';
import { AdminOccPreviewProvider } from '../features/admin-occ/AdminOccPreviewContext';
import HumanResourcesLayout from '../features/human-resources/HumanResourcesLayout';
import ContractsShell from '../features/contracts/shell/ContractsShell';
import FinanceShell from '../features/finance/shell/FinanceShell';
import GovernanceShell from '../features/governance/GovernanceShell';
import CustomWorkspace from '../features/governance/CustomWorkspace';

const roleKeys = {
  adminOcc: ROLE_KEYS.ADMIN_OCC,
  humanResources: ROLE_KEYS.GESTION_HUMANA,
  contracts: ROLE_KEYS.CONTRATOS,
  finance: ROLE_KEYS.FINANZAS,
  superadmin: ROLE_KEYS.SUPERADMIN,
  custom: ROLE_KEYS.CUSTOM,
};

export default function RoleLayout({ role, children }) {
  return (
    <ProtectedRole role={roleKeys[role]}>
      {({ user, onLogout }) => {
        if (role === 'adminOcc') {
          return <AdminOccPreviewProvider><AdminOccLayout user={user} onLogout={onLogout}>{children}</AdminOccLayout></AdminOccPreviewProvider>;
        }
        if (role === 'humanResources') return <HumanResourcesLayout user={user} onLogout={onLogout}>{children}</HumanResourcesLayout>;
        if (role === 'contracts') return <ContractsShell user={user} onLogout={onLogout} />;
        if (role === 'finance') return <FinanceShell user={user} onLogout={onLogout} />;
        if (role === 'superadmin') return <GovernanceShell user={user} onLogout={onLogout} />;
        return <CustomWorkspace user={user} onLogout={onLogout} />;
      }}
    </ProtectedRole>
  );
}
