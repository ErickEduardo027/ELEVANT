import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { createHumanResourcesChildren } from './router';
import { HUMAN_RESOURCES_NAVIGATION } from '../features/human-resources/navigation';

vi.mock('../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({
    start: () => Promise.resolve(), stop: () => Promise.resolve(),
  }),
}));

describe('HR routes with operational ramp profiles', () => {
  it('keeps the live ramp profile list and redirects unavailable deep routes', async () => {
    const children = createHumanResourcesChildren(true);
    expect(children.map(route => route.path)).toEqual(['dashboard', 'users', '*']);

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
});
