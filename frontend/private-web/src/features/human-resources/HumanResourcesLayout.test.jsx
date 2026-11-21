import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import HumanResourcesLayout from './HumanResourcesLayout';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';

let shellProps;

vi.mock('../shell/AppShell', () => ({
  default: props => {
    shellProps = props;
    return <div data-testid="app-shell">{props.children}</div>;
  },
}));

// Each entry of the menu with the ids of its modules.
const menu = navigation => navigation.map(item => (item.children ? [item.label, item.children.map(child => child.id)] : item.id));
const ADMIN_MENU = [
  ['Personal', ['dashboard', 'employees']],
  ['Operación de rampa', ['users', 'certifications', 'permits', 'schedules', 'attendance']],
  ['Seguimiento', ['reports', 'audit']],
  ['Accesos', ['access-requests', 'department-users']],
  'settings',
];
const child = id => shellProps.navigation.flatMap(item => item.children ?? [item]).find(item => item.id === id);

describe('HumanResourcesLayout dashboard-only demo', () => {
  beforeEach(() => {
    shellProps = undefined;
    vi.clearAllMocks();
  });

  it('exposes connected HR reads without a synthetic qualification badge', () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('human-resources', DepartmentPermissionCodes.humanResources)}><HumanResourcesLayout dashboardReadOnlyDemo /></DepartmentAccessProvider>);

    // ADR-0045: the Development VPS runs this demo mode, and Configuración is real data, so it stays.
    expect(menu(shellProps.navigation)).toEqual(ADMIN_MENU);
    expect(child('certifications').badge).toBeNull();
    expect(child('permits').badge).toBeNull();
    expect(child('schedules').badge).toBeNull();
    expect(child('reports').badge).toBeNull();
    // Department alerts are real data, so the read-only demo keeps the bell.
    expect(shellProps.notificationsSource).toBe('department');
    expect(shellProps.notificationsEnabled).toBe(true);
    expect(shellProps.profileActionsEnabled).toBe(false);
  });

  it('retains the full HR navigation and the bell when the demo flag is absent', async () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('human-resources', DepartmentPermissionCodes.humanResources)}><HumanResourcesLayout dashboardReadOnlyDemo={false} /></DepartmentAccessProvider>);

    expect(menu(shellProps.navigation)).toEqual(ADMIN_MENU);
    expect(shellProps.notificationsSource).toBe('department');
    expect(shellProps.notificationsEnabled).toBe(true);
    expect(shellProps.profileActionsEnabled).toBe(true);
    // The page Notificaciones is gone; the bell stays, governed by human_resources.notifications.read.
    expect(child('notifications')).toBeUndefined();
  });

  it('shows a member only the modules its permissions open', () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'human-resources',
      permissions: ['human_resources.access_requests.read', 'human_resources.access_requests.validate'], stations: [],
      canManageDepartmentUsers: false, canValidateAccessRequests: true }}><HumanResourcesLayout dashboardReadOnlyDemo={false} /></DepartmentAccessProvider>);

    expect(menu(shellProps.navigation)).toEqual([['Accesos', ['access-requests']]]);
  });

  it('opens Dashboard at the HR entry for an account that may read it', async () => {
    window.history.replaceState({}, '', '/gestion-humana');
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('human-resources', DepartmentPermissionCodes.humanResources)}><HumanResourcesLayout dashboardReadOnlyDemo={false} /></DepartmentAccessProvider>);
    await waitFor(() => expect(window.location.pathname).toBe('/gestion-humana/dashboard'));
  });

  it('sends an account without the dashboard grant to its first permitted module', async () => {
    window.history.replaceState({}, '', '/gestion-humana/dashboard');
    render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'human-resources',
      permissions: ['human_resources.reports.read', 'human_resources.access_requests.read'], stations: [],
      canManageDepartmentUsers: false, canValidateAccessRequests: true }}><HumanResourcesLayout dashboardReadOnlyDemo={false} /></DepartmentAccessProvider>);
    await waitFor(() => expect(window.location.pathname).toBe('/gestion-humana/reports'));
  });

  it('shows the no-modules notice to an account without HR modules', async () => {
    window.history.replaceState({}, '', '/gestion-humana/dashboard');
    render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'human-resources',
      permissions: [], stations: [], canManageDepartmentUsers: false, canValidateAccessRequests: false }}><HumanResourcesLayout dashboardReadOnlyDemo={false} /></DepartmentAccessProvider>);
    expect(await screen.findByText('Sin módulos asignados')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/gestion-humana/dashboard');
  });
});
