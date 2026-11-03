import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import OccHorizontalHeader from './OccHorizontalHeader';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin-occ/reports', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ priority: _priority, alt = '', ...props }) => <img alt={alt} {...props} /> }));
const initialWidth = window.innerWidth;
afterEach(() => { cleanup(); act(() => resetLanguageForTests('es')); Object.defineProperty(window, 'innerWidth', { value: initialWidth, configurable: true }); });
const navigation = [
  { id: 'reports', path: '/admin-occ/reports' },
  { id: 'positions-map', path: '/admin-occ/positions-map' },
  { id: 'flight-monitoring', path: '/admin-occ/flight-monitoring' },
];
function show(onLogout = vi.fn(), onToggleTheme = vi.fn(), entries = navigation) {
  return render(<LanguageScope><OccHorizontalHeader navigation={entries} user={{ name: 'Ana QA', role: 'OCC' }}
    notificationsEnabled={false} onLogout={onLogout} theme="light" onToggleTheme={onToggleTheme} /></LanguageScope>);
}

it('groups only authorized routes and marks the active module', async () => {
  show();
  expect(screen.queryByRole('button', { name: 'Comunicación' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Administración' })).not.toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'Operación' });
  expect(trigger).toHaveAttribute('data-active', 'true');
  await userEvent.click(trigger);
  expect(screen.getByRole('menuitem', { name: 'Reportes' })).toHaveAttribute('href', '/admin-occ/reports');
  expect(screen.getByRole('menuitem', { name: 'Reportes' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('menuitem', { name: /Posiciones|Monitoreo/ })).not.toBeInTheDocument();
});

it('uses the existing language preference and exposes theme beside it', async () => {
  const toggleTheme = vi.fn();
  show(vi.fn(), toggleTheme);
  expect(screen.getByRole('radio', { name: 'Español' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByText(/^UTC/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'English' }));
  expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  expect(document.documentElement.lang).toBe('en');
  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.getByRole('radio', { name: 'Español' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'Español' })).toHaveFocus();
  await userEvent.keyboard('{ArrowRight}');
  expect(document.documentElement.lang).toBe('en');
  await userEvent.click(screen.getByRole('button', { name: /dark/i }));
  expect(toggleTheme).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('supports Escape and passes the stable avatar as the logout return target', async () => {
  const logout = vi.fn();
  show(logout);
  const trigger = screen.getByRole('button', { name: 'Cuenta: Ana QA' });
  await userEvent.click(trigger);
  expect(screen.getByText(/^Hora UTC: \d{2}:\d{2}$/)).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: /tema/i })).not.toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
  expect(logout).toHaveBeenCalledWith({ returnFocusTo: trigger });
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
});

it('uses the same ordered groups in the compact navigation and returns focus', async () => {
  Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
  show(vi.fn(), vi.fn(), [
    { id: 'dashboard', path: '/admin-occ/dashboard' }, { id: 'planning', path: '/admin-occ/planning' },
    { id: 'approvals', path: '/admin-occ/review' }, { id: 'reports', path: '/admin-occ/reports' },
    { id: 'expenses', path: '/admin-occ/expenses' }, { id: 'notifications', path: '/admin-occ/notifications' },
    { id: 'chat', path: '/admin-occ/chat' }, { id: 'users', path: '/admin-occ/users' },
  ]);
  fireEvent(window, new Event('resize'));
  const trigger = screen.getByRole('button', { name: 'Abrir navegación' });
  await userEvent.click(trigger);
  expect(screen.getAllByRole('menuitem').map(link => link.getAttribute('href'))).toEqual([
    '/admin-occ/dashboard', '/admin-occ/planning', '/admin-occ/review', '/admin-occ/reports',
    '/admin-occ/expenses', '/admin-occ/notifications', '/admin-occ/chat', '/admin-occ/users',
  ]);
  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
});
