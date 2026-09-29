import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import HumanResourcesLayout from './HumanResourcesLayout';
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
    render(<HumanResourcesLayout dashboardReadOnlyDemo />);

    expect(shellProps.navigation.map(item => item.id)).toEqual(['dashboard', 'users', 'certifications', 'permits', 'schedules']);
    expect(shellProps.navigation.find(item => item.id === 'certifications').badge).toBeNull();
    expect(shellProps.navigation.find(item => item.id === 'permits').badge).toBeNull();
    expect(shellProps.navigation.find(item => item.id === 'schedules').badge).toBeNull();
    expect(shellProps.notificationsPath).toBeUndefined();
    expect(shellProps.notificationsEnabled).toBe(false);
    expect(shellProps.profileActionsEnabled).toBe(false);
    expect(getHumanResourcesUnreadNotificationsCount).not.toHaveBeenCalled();
  });

  it('retains the full HR navigation and notifications when the demo flag is absent', async () => {
    render(<HumanResourcesLayout dashboardReadOnlyDemo={false} />);

    expect(shellProps.navigation.map(item => item.id)).toEqual([
      'dashboard',
      'users',
      'certifications',
      'permits',
      'schedules',
      'reports',
      'audit',
      'notifications',
    ]);
    expect(shellProps.notificationsPath).toBe('/gestion-humana/notifications');
    expect(shellProps.notificationsEnabled).toBe(true);
    expect(shellProps.profileActionsEnabled).toBe(true);
    await waitFor(() => expect(getHumanResourcesUnreadNotificationsCount).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(shellProps.navigation.find(item => item.id === 'notifications').badge.count).toBe(2);
    });
  });
});
