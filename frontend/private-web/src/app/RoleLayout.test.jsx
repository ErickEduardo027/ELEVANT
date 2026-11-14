import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// The props each DepartmentAccessProvider received, in mount order.
const providers = vi.hoisted(() => []);
// The pieces of the OCC boot screen that RoleLayout rendered, in render order.
const boots = vi.hoisted(() => []);

// Each gate is drawn as a box, so the tests can read how RoleLayout nests them.
vi.mock('../../app/auth-boundary', () => ({
  ProtectedRole: ({ children }) => (
    <div data-gate="session">{children({ user: { name: 'Alex Operations', role: 'Administrador' }, onLogout: () => {} })}</div>
  ),
}));
vi.mock('../features/access/DepartmentAccessContext', () => ({
  DepartmentAccessProvider: ({ children, ...props }) => {
    providers.push(props);
    return <div data-gate="access">{children}</div>;
  },
  AccessGate: ({ children }) => <div data-gate="permissions">{children}</div>,
}));
vi.mock('../features/admin-occ/boot/OccBootProvider', () => ({
  OccBootProvider: ({ children }) => {
    boots.push('provider');
    return <div data-gate="boot">{children}</div>;
  },
  OccBootAccessSignal: () => {
    boots.push('signal');
    return <span data-gate="boot-signal" />;
  },
}));
vi.mock('../features/admin-occ/AdminOccPreviewContext', () => ({ AdminOccPreviewProvider: ({ children }) => children }));
vi.mock('../features/admin-occ/AdminOccLayout', () => ({ default: ({ children }) => <div>Marco OCC{children}</div> }));
vi.mock('../features/human-resources/HumanResourcesLayout', () => ({ default: () => <div>Marco Gestión Humana</div> }));
vi.mock('../features/contracts/shell/ContractsShell', () => ({ default: () => <div>Marco Contratos</div> }));
vi.mock('../features/finance/shell/FinanceShell', () => ({ default: () => <div>Marco Finanzas</div> }));
vi.mock('../features/governance/GovernanceShell', () => ({ default: () => <div>Marco Superadministración</div> }));

import RoleLayout from './RoleLayout';

const gate = name => document.querySelector(`[data-gate="${name}"]`);

afterEach(() => {
  cleanup();
  providers.length = 0;
  boots.length = 0;
});

it('turns off the access observer for adminOcc only', () => {
  render(<RoleLayout role="adminOcc"><p>Panorama</p></RoleLayout>);
  expect(screen.getByText('Marco OCC')).toBeInTheDocument();
  expect(screen.getByText('Panorama')).toBeInTheDocument();
  // The OCC shell owns the tab's only observer and refreshes access from it.
  expect(providers).toEqual([{ observe: false }]);
});

it('mounts the boot screen for adminOcc only, around the session and access gates', () => {
  const { container } = render(<RoleLayout role="adminOcc"><p>Panorama</p></RoleLayout>);
  expect(boots).toEqual(['provider', 'signal']);
  // Outermost, so it stays up through the session check and then the access load.
  expect(container.firstElementChild).toBe(gate('boot'));
  expect(gate('boot')).toContainElement(gate('session'));
  expect(gate('session')).toContainElement(gate('access'));
  expect(gate('access')).toContainElement(gate('permissions'));
  expect(gate('permissions')).toContainElement(screen.getByText('Panorama'));
  // The access signal sits next to AccessGate, not behind it: it reports while the gate shows loading or its error.
  expect(gate('access')).toContainElement(gate('boot-signal'));
  expect(gate('permissions')).not.toContainElement(gate('boot-signal'));
});

it('keeps the access observer for humanResources, contracts, finance and superadmin', () => {
  for (const [role, shell] of [['humanResources', 'Marco Gestión Humana'], ['contracts', 'Marco Contratos'],
    ['finance', 'Marco Finanzas'], ['superadmin', 'Marco Superadministración']]) {
    const view = render(<RoleLayout role={role} />);
    expect(screen.getByText(shell), role).toBeInTheDocument();
    expect(providers.at(-1), role).toEqual({ observe: true });
    // The OCC boot screen is the OCC's alone.
    expect(gate('boot'), role).toBeNull();
    expect(gate('boot-signal'), role).toBeNull();
    expect(view.container.firstElementChild, role).toBe(gate('session'));
    view.unmount();
  }
  expect(providers).toHaveLength(4);
  expect(boots).toEqual([]);
});
