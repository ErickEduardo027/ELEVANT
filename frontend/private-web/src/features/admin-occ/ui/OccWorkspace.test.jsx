import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import OccContextLinks from './OccContextLinks';
import OccWorkspace from './OccWorkspace';

afterEach(() => window.history.replaceState({}, '', '/'));

it('does not wrap Panorama or replace its mounted content on an unchanged route', () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  const view = render(<OccWorkspace><div data-testid="panorama" /></OccWorkspace>);
  const original = screen.getByTestId('panorama');
  view.rerender(<OccWorkspace><div data-testid="panorama" /></OccWorkspace>);
  expect(screen.getByTestId('panorama')).toBe(original);
  expect(view.container.querySelector('[data-occ-workspace]')).toBeNull();
});

it('contains the visual system inside the selected non-Panorama module', () => {
  window.history.replaceState({}, '', '/admin-occ/planning');
  const view = render(<OccWorkspace><div>Planning</div></OccWorkspace>);
  expect(view.container.querySelector('[data-occ-workspace="planning"]')).toBeInTheDocument();
  act(() => { window.history.pushState({}, '', '/admin-occ/dashboard'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(view.container.querySelector('[data-occ-workspace]')).toBeNull();
});

it.each([
  [[], []],
  [['operations.positions_map.read'], ['/admin-occ/positions-map']],
  [['operations.flight_monitoring.read'], ['/admin-occ/flight-monitoring']],
  [['operations.positions_map.read', 'operations.flight_monitoring.read'], ['/admin-occ/flight-monitoring', '/admin-occ/positions-map']],
])('keeps contextual links limited to their independent grants (%j)', (permissions, paths) => {
  render(<DepartmentAccessProvider initialAccess={{ kind: 'Member', department: 'Operations', permissions }} observe={false}>
    <OccContextLinks />
  </DepartmentAccessProvider>);
  expect(screen.queryAllByRole('link').map(link => link.getAttribute('href'))).toEqual(paths);
});
