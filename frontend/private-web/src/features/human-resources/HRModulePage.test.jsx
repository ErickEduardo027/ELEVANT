import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import HRModulePage from './HRModulePage';

vi.mock('./attendance/AttendanceReviewPage', () => ({
  default: () => <h1 data-testid="attendance-review-page">Revisión de asistencia</h1>,
}));

it('mounts the attendance review at the HR attendance route', () => {
  render(<HRModulePage moduleId="attendance" />);
  expect(screen.getByTestId('attendance-review-page')).toHaveTextContent('Revisión de asistencia');
});
