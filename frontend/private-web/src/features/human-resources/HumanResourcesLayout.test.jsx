import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import HumanResourcesLayout from './HumanResourcesLayout';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { getHumanResourcesUnreadNotificationsCount } from '../../services/humanResourcesNotificationsService';

let shellProps;

vi.mock('../shell/AppShell', () => ({
  default: props => {
    shellProps = props;
    return <div data-testid="app-shell" />;
  },
}));

vi.mock('../../services/humanResourcesNotificationsService', () => ({
  getHumanResourcesUnreadNotificationsCount: vi.fn(),
  subscribeHumanResourcesNotifications: vi.fn(() => () => {}),
}));

describe('HumanResourcesLayout dashboard-only demo', () => {
  beforeEach(() => {
    shellProps = undefined;
    vi.clearAllMocks();
    getHumanResourcesUnreadNotificationsCount.mockResolvedValue(2);
  });

  it('exposes connected HR reads without a synthetic qualification badge', () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('human-resources', DepartmentPermissionCodes.humanResources)}><HumanResourcesLayout dashboardReadOnlyDemo /></DepartmentAccessProvider>);

    expect(shellProps.navigation.map(item => item.id)).toEqual(['dashboard', 'users', 'certifications', 'permits', 'schedules', 'attendance', 'reports',
      'access-requests', 'department-users']);
    expect(shellProps.navigation.find(item => item.id === 'certifications').badge).toBeNull();
    expect(shellProps.navigation.find(item => item.id === 'permits').badge).toBeNull();
    expect(shellProps.navigation.find(item => item.id === 'schedules').badge).toBeNull();
    expect(shellProps.navigation.find(item => item.id === 'reports').badge).toBeNull();
    expect(shellProps.notificationsPath).toBeUndefined();
    expect(shellProps.notificationsEnabled).toBe(false);
    expect(shellProps.profileActionsEnabled).toBe(false);
    expect(getHumanResourcesUnreadNotificationsCount).not.toHaveBeenCalled();
  });

  it('retains the full HR navigation and notifications when the demo flag is absent', async () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('human-resources', DepartmentPermissionCodes.humanResources)}><HumanResourcesLayout dashboardReadOnlyDemo={false} /></DepartmentAccessProvider>);

    expect(shellProps.navigation.map(item => item.id)).toEqual([
      'dashboard',
      'users',
      'certifications',
      'permits',
      'schedules',
      'attendance',
      'reports',
      'audit',
      'notifications',
      'access-requests',
      'department-users',
    ]);
    expect(shellProps.notificationsPath).toBe('/gestion-humana/notifications');
    expect(shellProps.notificationsEnabled).toBe(true);
    expect(shellProps.profileActionsEnabled).toBe(true);
    await waitFor(() => expect(getHumanResourcesUnreadNotificationsCount).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(shellProps.navigation.find(item => item.id === 'notifications').badge.count).toBe(2);
    });
  });

  it('shows a member only the modules its permissions open', () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Member', department: 'human-resources',
      permissions: ['human_resources.access_requests.read', 'human_resources.access_requests.validate'], stations: [],
      canManageDepartmentUsers: false, canValidateAccessRequests: true }}><HumanResourcesLayout dashboardReadOnlyDemo={false} /></DepartmentAccessProvider>);

    expect(shellProps.navigation.map(item => item.id)).toEqual(['access-requests']);
  });
});
