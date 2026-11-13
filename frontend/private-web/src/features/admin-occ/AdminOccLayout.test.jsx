import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadOperationalNotifications } from '../../services/operationalCommunicationService';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import AdminOccLayout from './AdminOccLayout';
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
  });
});
