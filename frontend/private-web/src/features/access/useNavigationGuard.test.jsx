import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const route = vi.hoisted(() => ({ path: '/admin-occ', replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path, useRouter: () => ({ replace: route.replace }) }));
import { useNavigationGuard } from './useNavigationGuard';

const navigation = [
  { id: 'planning', path: '/admin-occ/planning' },
  { id: 'dashboard', path: '/admin-occ/dashboard' },
  { id: 'reports', path: '/admin-occ/reports' },
];
const [planning, dashboard, reports] = navigation;
const options = { homePath: '/admin-occ/dashboard', basePath: '/admin-occ' };
beforeEach(() => { route.path = '/admin-occ'; route.replace.mockClear(); });

it('chooses Dashboard at the department entry rather than the first catalog entry', () => {
  renderHook(() => useNavigationGuard(navigation, navigation, options));
  expect(route.replace).toHaveBeenCalledWith('/admin-occ/dashboard');
  expect(route.replace).not.toHaveBeenCalledWith('/admin-occ/planning');
});

it('sends an account without Dashboard from the entry to its first permitted module', () => {
  renderHook(() => useNavigationGuard(navigation, [reports], options));
  expect(route.replace).toHaveBeenCalledWith('/admin-occ/reports');
});

it('sends an account without Dashboard from the Dashboard route to its first permitted module', () => {
  route.path = '/admin-occ/dashboard';
  const { result } = renderHook(() => useNavigationGuard(navigation, [reports, planning], options));
  expect(result.current).toMatchObject({ permitted: false, empty: false });
  expect(route.replace).toHaveBeenCalledWith('/admin-occ/reports');
});

it('renders a permitted module where it is', () => {
  route.path = '/admin-occ/reports';
  const { result } = renderHook(() => useNavigationGuard(navigation, [dashboard, reports], options));
  expect(result.current).toMatchObject({ permitted: true, empty: false });
  expect(route.replace).not.toHaveBeenCalled();
});

it('stays put and reports an empty menu when the account has no module', () => {
  route.path = '/admin-occ/dashboard';
  const { result } = renderHook(() => useNavigationGuard(navigation, [], options));
  expect(result.current).toMatchObject({ permitted: false, empty: true });
  expect(route.replace).not.toHaveBeenCalled();
});

it('preserves the first-module fallback for departments without an entry policy', () => {
  renderHook(() => useNavigationGuard(navigation, navigation));
  expect(route.replace).toHaveBeenCalledWith('/admin-occ/planning');
});
