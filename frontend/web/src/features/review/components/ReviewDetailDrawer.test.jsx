import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewDetailDrawer from './ReviewDetailDrawer';

function buildOperation(overrides = {}) {
  return {
    id: 'REV-1001',
    status: 'PENDING_REVIEW',
    priority: 'NORMAL',
    flight: { number: 'DM161', airline: 'Arajet', origin: 'MIA', destination: 'PUJ', aircraftType: 'B737 MAX 8', registration: 'HI1024' },
    schedule: { sta: '2026-08-05T14:20:00-04:00', ata: '2026-08-05T14:27:00-04:00', std: '2026-08-05T15:35:00-04:00', atd: '2026-08-05T15:42:00-04:00' },
    position: 'A5',
    incidents: [],
    planned: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    actual: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    timeline: { blocksOn: '2026-08-05T14:20:00-04:00' },
    services: [{ name: 'GPU', status: 'completed' }],
    equipment: [{ name: 'GPU', planned: 1, reported: 1, used: 1 }],
    evidence: [],
    signatures: [{ name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: '2026-08-05T15:43:00-04:00' }],
    observations: [],
    reconciliation: [],
    history: [{ at: '2026-08-05T15:45:00-04:00', action: 'Reporte enviado a revisión', user: 'Carlos Medina', comment: '' }],
    ...overrides,
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('ReviewDetailDrawer', () => {
  it('renders nothing when there is no operation', () => {
    const { container } = render(<ReviewDetailDrawer operation={null} onClose={() => {}} onApprove={() => {}} onReturn={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the header with flight number, airline, status, and position', () => {
    render(<ReviewDetailDrawer operation={buildOperation()} onClose={() => {}} onApprove={() => {}} onReturn={() => {}} />);
    expect(screen.getByTestId('review-detail-drawer')).toBeInTheDocument();
    expect(screen.getByText('DM161 · Arajet')).toBeInTheDocument();
    expect(screen.getByText('Pendiente de revisión')).toBeInTheDocument();
    expect(screen.getByText(/Posición A5/)).toBeInTheDocument();
  });

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<ReviewDetailDrawer operation={buildOperation()} onClose={onClose} onApprove={() => {}} onReturn={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<ReviewDetailDrawer operation={buildOperation()} onClose={onClose} onApprove={() => {}} onReturn={() => {}} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an approval confirmation before calling onApprove, and calls it with the operation id', async () => {
    const onApprove = vi.fn();
    render(<ReviewDetailDrawer operation={buildOperation()} onClose={() => {}} onApprove={onApprove} onReturn={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onApprove).toHaveBeenCalledWith('REV-1001');
  });

  it('shows the return-correction modal and calls onReturn with the operation id and reason once valid', async () => {
    const onReturn = vi.fn();
    render(<ReviewDetailDrawer operation={buildOperation()} onClose={() => {}} onApprove={() => {}} onReturn={onReturn} />);

    await userEvent.click(screen.getByRole('button', { name: /devolver con correcciones/i }));
    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).toBeDisabled();

    await userEvent.type(
      screen.getByPlaceholderText('Indique qué información debe corregirse o completarse.'),
      'Falta evidencia de cierre.'
    );
    await userEvent.click(confirmButton);
    expect(onReturn).toHaveBeenCalledWith('REV-1001', 'Falta evidencia de cierre.');
  });

  it('scrolls to the history section when "Ver historial" is clicked', async () => {
    render(<ReviewDetailDrawer operation={buildOperation()} onClose={() => {}} onApprove={() => {}} onReturn={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /ver historial/i }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('resets any open confirmation when switching to a different operation', async () => {
    const { rerender } = render(
      <ReviewDetailDrawer operation={buildOperation()} onClose={() => {}} onApprove={() => {}} onReturn={() => {}} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    rerender(
      <ReviewDetailDrawer operation={buildOperation({ id: 'REV-1002' })} onClose={() => {}} onApprove={() => {}} onReturn={() => {}} />
    );
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
