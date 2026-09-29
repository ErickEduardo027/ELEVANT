import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { createHumanResourcesChildren } from './router';
import { HUMAN_RESOURCES_NAVIGATION } from '../features/human-resources/navigation';
import { getHumanResourcesQualifications } from '../services/humanResourcesQualificationsReadService';
import { getHumanResourcesPermits } from '../services/humanResourcesPermitsReadService';
import { getHumanResourcesShifts } from '../services/humanResourcesShiftsReadService';

vi.mock('../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({
    start: () => Promise.resolve(), stop: () => Promise.resolve(),
  }),
}));
vi.mock('../services/humanResourcesQualificationsReadService', () => ({
  getHumanResourcesQualifications: vi.fn(),
}));
vi.mock('../services/humanResourcesPermitsReadService', () => ({
  getHumanResourcesPermits: vi.fn(),
}));
vi.mock('../services/humanResourcesShiftsReadService', () => ({
  getHumanResourcesShifts: vi.fn(),
}));

describe('HR routes with operational ramp profiles', () => {
  it('keeps live ramp profiles and current qualifications while redirecting unavailable deep routes', async () => {
    const children = createHumanResourcesChildren(true);
    expect(children.map(route => route.path)).toEqual(['dashboard', 'users', 'certifications', 'permits', 'schedules', 'reports', '*']);

    const router = createMemoryRouter(
      [{ path: '/gestion-humana', element: <Outlet />, children }],
      { initialEntries: ['/gestion-humana/users/123/edit'] },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gestion-humana/dashboard');
    });
    expect(screen.queryByText('Datos sintéticos · Solo lectura')).not.toBeInTheDocument();
  });

  it('retains every HR module and no wildcard redirect when the demo flag is absent', () => {
    const children = createHumanResourcesChildren(false);

    expect(children.map(route => route.path)).toEqual(
      HUMAN_RESOURCES_NAVIGATION.map(item => item.path.split('/').at(-1)),
    );
    expect(children.some(route => route.path === '*')).toBe(false);
  });

  it('mounts the real read-only qualifications page in the restricted release', async () => {
    getHumanResourcesQualifications.mockResolvedValue({ page: 1, limit: 20,
      hasMore: false, qualifications: [] });
    const router = createMemoryRouter(
      [{ path: '/gestion-humana', element: <Outlet />,
        children: createHumanResourcesChildren(true) }],
      { initialEntries: ['/gestion-humana/certifications'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/No hay habilitaciones registradas/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar|Renovar/ })).not.toBeInTheDocument();
    expect(getHumanResourcesQualifications).toHaveBeenCalledWith(
      { page: 1, limit: 20 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('mounts the real read-only permit page in the restricted release', async () => {
    getHumanResourcesPermits.mockResolvedValue({ page: 1, limit: 20,
      hasMore: false, permits: [] });
    const router = createMemoryRouter(
      [{ path: '/gestion-humana', element: <Outlet />,
        children: createHumanResourcesChildren(true) }],
      { initialEntries: ['/gestion-humana/permits'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/No hay permisos registrados/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar|Renovar/ })).not.toBeInTheDocument();
    expect(getHumanResourcesPermits).toHaveBeenCalledWith(
      { page: 1, limit: 20 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('mounts the real read-only shift page in the restricted release', async () => {
    getHumanResourcesShifts.mockImplementation(async query => ({
      ...query, hasMore: false, shifts: [],
    }));
    const router = createMemoryRouter(
      [{ path: '/gestion-humana', element: <Outlet />,
        children: createHumanResourcesChildren(true) }],
      { initialEntries: ['/gestion-humana/schedules'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/No hay turnos registrados/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Asignar|Eliminar|Aprobar/ })).not.toBeInTheDocument();
    expect(getHumanResourcesShifts).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('mounts the real read-only personnel report instead of the prototype', async () => {
    getHumanResourcesQualifications.mockResolvedValue({ qualifications: [], hasMore: false });
    getHumanResourcesPermits.mockResolvedValue({ permits: [], hasMore: false });
    getHumanResourcesShifts.mockResolvedValue({ shifts: [], hasMore: false });
    const router = createMemoryRouter(
      [{ path: '/gestion-humana', element: <Outlet />,
        children: createHumanResourcesChildren(true) }],
      { initialEntries: ['/gestion-humana/reports'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Reportes de personal')).toBeInTheDocument();
    expect(await screen.findByText(/No hay vigencias registradas/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/gestion-humana/reports');
    expect(getHumanResourcesQualifications).toHaveBeenCalledWith(
      { page: 1, limit: 100 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
