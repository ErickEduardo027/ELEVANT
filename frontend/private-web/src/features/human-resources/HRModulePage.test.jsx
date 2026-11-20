import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HRModulePage from './HRModulePage';
import { getRampProfiles } from '../../services/commercialGovernanceApi';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock('./attendance/AttendanceReviewPage', () => ({
  default: () => <h1 data-testid="attendance-review-page">Revisión de asistencia</h1>,
}));
vi.mock('./certifications/CurrentQualificationsPage', () => ({ default: () => <h1>API habilitaciones</h1> }));
vi.mock('./permits/CurrentPermitsPage', () => ({ default: () => <h1>API permisos</h1> }));
vi.mock('./schedules/CurrentShiftsPage', () => ({ default: () => <h1>API horarios</h1> }));
vi.mock('./users/RampReadinessPanel', () => ({
  default: () => <section aria-label="¿Puede operar?"><h2>¿Puede operar?</h2></section>,
}));
vi.mock('../../services/commercialGovernanceApi', async importOriginal => ({
  ...(await importOriginal()), getRampProfiles: vi.fn(),
}));
vi.mock('../../services/accountChangeObserver', async importOriginal => ({
  ...(await importOriginal()),
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
}));

it('shows «¿Puede operar?» after the heading of «Agentes de rampa», inside its page (N37)', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [], availableStations: [] });
  render(<HRModulePage moduleId="users" />);
  await screen.findByText('Aún no hay perfiles.');
  const heading = screen.getByRole('heading', { level: 1, name: 'Agentes de rampa' });
  const readiness = screen.getByRole('region', { name: '¿Puede operar?' });
  const directory = screen.getByRole('heading', { level: 2, name: 'Personal registrado' });
  expect(heading.compareDocumentPosition(readiness) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(readiness.compareDocumentPosition(directory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The page's own column, the one of its heading: never above the heading nor wider than the page.
  expect(heading.closest('header').parentElement).toContainElement(readiness);
});

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
