import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewHistoryLog from './ReviewHistoryLog';

describe('ReviewHistoryLog', () => {
  it('shows the empty copy when there is no history', () => {
    render(<ReviewHistoryLog history={[]} />);
    expect(screen.getByText('Sin eventos registrados.')).toBeInTheDocument();
  });

  it('renders each history entry with its action, user, and comment', () => {
    render(
      <ReviewHistoryLog
        history={[
          { at: '2026-08-05T15:45:00-04:00', action: 'Reporte enviado a revisión', user: 'Carlos Medina', comment: '' },
          {
            at: '2026-08-05T16:02:00-04:00',
            action: 'Devuelto con correcciones',
            user: 'Administrador OCC',
            comment: 'Falta evidencia de cierre.',
          },
        ]}
      />
    );
    expect(screen.getByText(/Reporte enviado a revisión/)).toBeInTheDocument();
    expect(screen.getByText(/Devuelto con correcciones/)).toBeInTheDocument();
    expect(screen.getByText('Falta evidencia de cierre.')).toBeInTheDocument();
  });
});