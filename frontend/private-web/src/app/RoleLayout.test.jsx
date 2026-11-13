import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// The props each DepartmentAccessProvider received, in mount order.
const providers = vi.hoisted(() => []);

vi.mock('../../app/auth-boundary', () => ({
  ProtectedRole: ({ children }) => children({ user: { name: 'Alex Operations', role: 'Administrador' }, onLogout: () => {} }),
}));
vi.mock('../features/access/DepartmentAccessContext', () => ({
  DepartmentAccessProvider: ({ children, ...props }) => {
    providers.push(props);
    return children;
  },
  AccessGate: ({ children }) => children,
}));
vi.mock('../features/admin-occ/AdminOccPreviewContext', () => ({ AdminOccPreviewProvider: ({ children }) => children }));
vi.mock('../features/admin-occ/AdminOccLayout', () => ({ default: ({ children }) => <div>Marco OCC{children}</div> }));
vi.mock('../features/human-resources/HumanResourcesLayout', () => ({ default: () => <div>Marco Gestión Humana</div> }));
vi.mock('../features/contracts/shell/ContractsShell', () => ({ default: () => <div>Marco Contratos</div> }));
vi.mock('../features/finance/shell/FinanceShell', () => ({ default: () => <div>Marco Finanzas</div> }));
vi.mock('../features/governance/GovernanceShell', () => ({ default: () => <div>Marco Superadministración</div> }));

import RoleLayout from './RoleLayout';

afterEach(() => {
  cleanup();
  providers.length = 0;
});

it('turns off the access observer for adminOcc only', () => {
  render(<RoleLayout role="adminOcc"><p>Panorama</p></RoleLayout>);
  expect(screen.getByText('Marco OCC')).toBeInTheDocument();
  expect(screen.getByText('Panorama')).toBeInTheDocument();
  // The OCC shell owns the tab's only observer and refreshes access from it.
  expect(providers).toEqual([{ observe: false }]);
});

it('keeps the access observer for humanResources, contracts, finance and superadmin', () => {
  for (const [role, shell] of [['humanResources', 'Marco Gestión Humana'], ['contracts', 'Marco Contratos'],
    ['finance', 'Marco Finanzas'], ['superadmin', 'Marco Superadministración']]) {
    const view = render(<RoleLayout role={role} />);
    expect(screen.getByText(shell), role).toBeInTheDocument();
    expect(providers.at(-1), role).toEqual({ observe: true });
    view.unmount();
  }
  expect(providers).toHaveLength(4);
});
