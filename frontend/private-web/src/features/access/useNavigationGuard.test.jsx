import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const route = vi.hoisted(() => ({ path: '/admin-occ', replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => route.path, useRouter: () => ({ replace: route.replace }) }));
import { useNavigationGuard } from './useNavigationGuard';

const navigation = [{ id: 'expenses', path: '/admin-occ/expenses' }, { id: 'dashboard', path: '/admin-occ/dashboard' }];
const options = { homePath: '/admin-occ/dashboard', basePath: '/admin-occ' };
beforeEach(() => { route.path = '/admin-occ'; route.replace.mockClear(); });
it('chooses Dashboard at the OCC entry rather than the first catalog entry', () => {
  renderHook(() => useNavigationGuard(navigation, navigation, options));
  expect(route.replace).toHaveBeenCalledWith('/admin-occ/dashboard');
  expect(route.replace).not.toHaveBeenCalledWith('/admin-occ/expenses');
});
it('keeps an unauthorized Dashboard available for an explicit access notice', () => {
  route.path = '/admin-occ/dashboard';
  const { result } = renderHook(() => useNavigationGuard(navigation, [navigation[0]], options));
  expect(result.current).toMatchObject({ permitted: false, homeDenied: true, empty: false });
  expect(route.replace).not.toHaveBeenCalled();
});
it('preserves the legacy fallback for departments without an entry policy', () => {
  renderHook(() => useNavigationGuard(navigation, navigation));
  expect(route.replace).toHaveBeenCalledWith('/admin-occ/expenses');
});
