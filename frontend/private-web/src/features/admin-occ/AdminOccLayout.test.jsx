import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadOperationalNotifications } from '../../services/operationalCommunicationService';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import AdminOccLayout, { OCC_MAP_PATHS } from './AdminOccLayout';
import OccSidebar from './shell/OccSidebar';
import OccTopbar from './shell/OccTopbar';
import { useOptionalOccShell } from './shell/OccShellProvider';

let shellProps;

// As in HumanResourcesLayout.test.jsx: the generic shell is replaced by a probe that keeps its props.
vi.mock('../shell/AppShell', () => ({
  default: props => {
    shellProps = props;
    return <div data-testid="app-shell">{props.children}</div>;
  },
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ session: { accountId: '30000000-0000-4000-8000-000000000001', stationScopes: [] } }),
}));
vi.mock('../../services/operationalCommunicationService', () => ({
  loadOperationalNotifications: vi.fn(),
  setOperationalNotificationRead: vi.fn(),
}));

const ACCESS = administratorAccess('operations', DepartmentPermissionCodes.operations);
const USER = { name: 'Alex Operations', role: 'Administrador / OCC' };

function ShellMarker() {
  const shell = useOptionalOccShell();
  return <p>{shell ? `Marco OCC con avisos: ${shell.notices.status}` : 'Sin marco OCC'}</p>;
}

function renderLayout() {
  return render(
    <DepartmentAccessProvider observe={false} initialAccess={ACCESS}>
      <AdminOccLayout user={USER} onLogout={vi.fn()}><ShellMarker /></AdminOccLayout>
    </DepartmentAccessProvider>,
  );
}

beforeEach(() => {
  shellProps = undefined;
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  loadOperationalNotifications.mockResolvedValue({ notifications: [], hasMore: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('mounts the shell provider and turns off AppShell notifications in the OCC', async () => {
  renderLayout();
  // The screens render inside the provider, which reads the notices once for the whole frame.
  expect(await screen.findByText('Marco OCC con avisos: empty')).toBeInTheDocument();
  expect(loadOperationalNotifications).toHaveBeenCalledOnce();
  // AppShell neither reads notices nor paints its own toasts in the OCC.
  expect(shellProps.notificationsEnabled).toBe(false);
  expect(shellProps.notificationsSource).toBeUndefined();
  expect(shellProps.notificationsPath).toBe('/admin-occ/notifications');
});

it('keeps the bridge attribute in the frame props', async () => {
  renderLayout();
  await screen.findByText('Marco OCC con avisos: empty');
  expect(shellProps.frameProps).toEqual({
    department: 'occ',
    rootAttributes: { 'data-occ-bridge': '' },
    SidebarComponent: OccSidebar,
    TopbarComponent: OccTopbar,
    rootClassName: 'bg-occ-canvas text-occ-text',
    // The URL of these tests is the console's (beforeEach): its map fills main.
    mainVariant: 'fill',
  });
});

it('the three map routes fill main without padding; other modules keep scrolling (M1)', async () => {
  // Panorama, Monitoreo de vuelos and Mapa de posiciones are full-screen maps with their panels floating inside
  // (contratos 2.5; M1): main takes them edge to edge, with no padding and no scroll. The set is exact and frozen.
  expect(OCC_MAP_PATHS).toEqual(['/admin-occ/dashboard', '/admin-occ/flight-monitoring', '/admin-occ/positions-map']);
  expect(Object.isFrozen(OCC_MAP_PATHS)).toBe(true);
  for (const path of OCC_MAP_PATHS) {
    window.history.replaceState({}, '', path);
    const map = renderLayout();
    await screen.findByText('Marco OCC con avisos: empty');
    expect(shellProps.frameProps.mainVariant, path).toBe('fill');
    expect(shellProps.frameProps).toMatchObject({ department: 'occ', rootAttributes: { 'data-occ-bridge': '' } });
    map.unmount();
  }

  // Every other module, and a path under a map route, keeps the padded main that scrolls.
  for (const path of ['/admin-occ/planning', '/admin-occ/dashboard/otra', '/admin-occ/positions-map/otra',
    '/admin-occ/reports', '/admin-occ/position-coverage']) {
    window.history.replaceState({}, '', path);
    const other = renderLayout();
    await screen.findByText('Marco OCC con avisos: empty');
    expect(shellProps.frameProps.mainVariant, path).toBe('scroll');
    expect(shellProps.frameProps).toMatchObject({ department: 'occ', rootAttributes: { 'data-occ-bridge': '' } });
    other.unmount();
  }
});

function renderWithAccess(access) {
  return render(
    <DepartmentAccessProvider observe={false} initialAccess={access}>
      <AdminOccLayout user={USER} onLogout={vi.fn()}><ShellMarker /></AdminOccLayout>
    </DepartmentAccessProvider>,
  );
}

it('opens Panorama at the OCC entry for an account that may read it', async () => {
  window.history.replaceState({}, '', '/admin-occ');
  renderWithAccess(ACCESS);
  await vi.waitFor(() => expect(window.location.pathname).toBe('/admin-occ/dashboard'));
});

it('sends an account without the dashboard grant to its first permitted module', async () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  renderWithAccess({ kind: 'Member', department: 'operations', permissions: ['operations.reports.read'], stations: [],
    canManageDepartmentUsers: false, canValidateAccessRequests: false });
  await vi.waitFor(() => expect(window.location.pathname).toBe('/admin-occ/reports'));
});

it('shows the no-modules notice to an account without OCC modules', async () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  renderWithAccess({ kind: 'Member', department: 'operations', permissions: [], stations: [],
    canManageDepartmentUsers: false, canValidateAccessRequests: false });
  expect(await screen.findByText('Sin módulos asignados')).toBeInTheDocument();
  expect(screen.getByText(/Tu cuenta todavía no tiene permisos en este departamento/)).toBeInTheDocument();
  expect(window.location.pathname).toBe('/admin-occ/dashboard');
});
