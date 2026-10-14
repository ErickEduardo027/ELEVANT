import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HRModulePage from './HRModulePage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('./attendance/AttendanceReviewPage', () => ({
  default: () => <h1 data-testid="attendance-review-page">Revisión de asistencia</h1>,
}));
vi.mock('./certifications/CurrentQualificationsPage', () => ({ default: () => <h1>API habilitaciones</h1> }));
vi.mock('./permits/CurrentPermitsPage', () => ({ default: () => <h1>API permisos</h1> }));
vi.mock('./schedules/CurrentShiftsPage', () => ({ default: () => <h1>API horarios</h1> }));

it('mounts the attendance review at the HR attendance route', () => {
  render(<HRModulePage moduleId="attendance" />);
  expect(screen.getByTestId('attendance-review-page')).toHaveTextContent('Revisión de asistencia');
});

it.each([
  ['certifications', 'API habilitaciones'],
  ['permits', 'API permisos'],
  ['schedules', 'API horarios'],
])('always mounts the API-backed page for %s', (moduleId, heading) => {
  render(<HRModulePage moduleId={moduleId} />);
  expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
});
