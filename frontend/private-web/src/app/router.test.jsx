import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { createHumanResourcesChildren } from './router';
import { HUMAN_RESOURCES_NAVIGATION } from '../features/human-resources/navigation';

describe('dashboard-only HR routes', () => {
  it('redirects every deep HR route to the synthetic dashboard', async () => {
    const children = createHumanResourcesChildren(true);
    expect(children.map(route => route.path)).toEqual(['dashboard', '*']);

    const router = createMemoryRouter(
      [{ path: '/gestion-humana', element: <Outlet />, children }],
      { initialEntries: ['/gestion-humana/users/123/edit'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Datos sintéticos · Solo lectura')).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/gestion-humana/dashboard');
    });
  });

  it('retains every HR module and no wildcard redirect when the demo flag is absent', () => {
    const children = createHumanResourcesChildren(false);

    expect(children.map(route => route.path)).toEqual(
      HUMAN_RESOURCES_NAVIGATION.map(item => item.path.split('/').at(-1)),
    );
    expect(children.some(route => route.path === '*')).toBe(false);
  });
});
