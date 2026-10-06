import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewPage from './ReviewPage';

function buildOperation(overrides = {}) {
  return {
    id: 'REV-1001',
    status: 'PENDING_REVIEW',
    priority: 'NORMAL',
    flight: { number: 'DM161', airline: 'Arajet', origin: 'MIA', destination: 'PUJ', aircraftType: 'B737 MAX 8', registration: 'HI1024' },
    schedule: { sta: '2026-08-05T14:20:00-04:00', ata: '2026-08-05T14:27:00-04:00', std: '2026-08-05T15:35:00-04:00', atd: '2026-08-05T15:42:00-04:00' },
    position: 'A5',
    agent: { name: 'Carlos Medina' },
    supervisor: { name: 'Juan Pérez' },
    submittedAt: '2026-08-05T15:45:00-04:00',
    approvedAt: null,
    planned: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    actual: { position: 'A5', startTime: '2026-08-05T14:20:00-04:00', agents: 5, teams: 2, services: ['GPU'], duration: 80, supervisor: 'Juan Pérez' },
    timeline: { blocksOn: '2026-08-05T14:20:00-04:00' },
    services: [{ name: 'GPU', status: 'completed' }],
    equipment: [{ name: 'GPU', planned: 1, reported: 1, used: 1 }],
    incidents: [],
    evidence: [],
    signatures: [{ name: 'Juan Pérez', role: 'Supervisor', status: 'signed', timestamp: '2026-08-05T15:43:00-04:00' }],
    reconciliation: [],
    observations: [],
    history: [{ at: '2026-08-05T15:45:00-04:00', action: 'Reporte enviado a revisión', user: 'Carlos Medina', comment: '' }],
    returnReason: null,
    ...overrides,
  };
}

const OPERATIONS = [
  buildOperation({ id: 'REV-1001', flight: { ...buildOperation().flight, number: 'DM161', airline: 'Arajet' } }),
  buildOperation({
    id: 'REV-1002',
    status: 'IN_REVIEW',
    flight: { ...buildOperation().flight, number: 'AA904', airline: 'American' },
  }),
  buildOperation({
    id: 'REV-1003',
    status: 'APPROVED',
    approvedAt: new Date().toISOString(),
    flight: { ...buildOperation().flight, number: 'DL500', airline: 'Delta' },
  }),
  buildOperation({
    id: 'REV-1004',
    status: 'RETURNED',
    flight: { ...buildOperation().flight, number: 'B6812', airline: 'JetBlue' },
  }),
];

const SNAPSHOT = { station: { code: 'PUJ' }, date: '2026-08-05', operations: OPERATIONS };

function renderPage(props = {}) {
  return render(
    <ReviewPage
      status="success"
      data={SNAPSHOT}
      error={null}
      onRetry={() => {}}
      onApprove={vi.fn().mockResolvedValue({})}
      onReturn={vi.fn().mockResolvedValue({})}
      onBulkApprove={vi.fn().mockResolvedValue([])}
      onBulkReturn={vi.fn().mockResolvedValue([])}
      {...props}
    />
  );
}

describe('ReviewPage', () => {
  it('renders the header, KPIs, tabs, and the pending queue by default', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Revisión' })).toBeInTheDocument();
    expect(screen.getByText('Pendientes de revisión')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /pendientes/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.queryByText('AA904')).not.toBeInTheDocument();
  });

  it('renders the skeleton when status is loading', () => {
    renderPage({ status: 'loading' });
    expect(screen.getByTestId('review-skeleton')).toBeInTheDocument();
  });

  it('shows a recoverable error panel with a retry action when status is error', async () => {
    const onRetry = vi.fn();
    renderPage({ status: 'error', data: null, error: new Error('network down'), onRetry });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when forceState is reviewEmpty, ignoring a real error', () => {
    renderPage({ status: 'error', data: null, error: new Error('down'), forceState: 'reviewEmpty' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No hay operaciones pendientes de revisión.')).toBeInTheDocument();
  });

  it('shows the error panel when forceState is reviewError even though status is success', () => {
    renderPage({ forceState: 'reviewError' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('switches tabs and shows the matching queue', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^en revisión/i }));
    expect(screen.getByText('AA904')).toBeInTheDocument();
    expect(screen.queryByText('DM161')).not.toBeInTheDocument();
  });

  it('clicking a KPI switches to its corresponding tab', async () => {
    renderPage();
    const buttons = screen.getAllByRole('button');
    const returnedKpi = buttons.find(button => button.textContent.includes('Devueltas'));
    await userEvent.click(returnedKpi);
    expect(screen.getByRole('tab', { name: /devueltas/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('B6812')).toBeInTheDocument();
  });

  it('narrows the visible queue with a filter', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'Arajet');
    expect(screen.getByText('DM161')).toBeInTheDocument();
  });

  it('quick-approves a clean pending operation from the row menu after confirmation', async () => {
    const onApprove = vi.fn().mockResolvedValue({});
    renderPage({ onApprove });
    await userEvent.click(screen.getByRole('button', { name: /acciones para dm161/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Aprobar' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onApprove).toHaveBeenCalledWith('REV-1001', { user: 'Administrador OCC' });
    expect(await screen.findByText('Operación aprobada correctamente.')).toBeInTheDocument();
  });

  it('selects rows and bulk-approves them with an explicit confirmation', async () => {
    const onBulkApprove = vi.fn().mockResolvedValue([]);
    renderPage({ onBulkApprove });

    const checkboxes = screen.getAllByRole('checkbox').filter(checkbox => checkbox.getAttribute('aria-label')?.startsWith('Seleccionar operación'));
    await userEvent.click(checkboxes[0]);
    expect(screen.getByText('1 operación seleccionada')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /aprobar seleccionadas/i }));
    expect(screen.getByText(/confirme que la operación ha sido revisada/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onBulkApprove).toHaveBeenCalledWith(['REV-1001'], { user: 'Administrador OCC' });
  });

  it('bulk-returns selected operations only once a reason is provided', async () => {
    const onBulkReturn = vi.fn().mockResolvedValue([]);
    renderPage({ onBulkReturn });

    const checkboxes = screen.getAllByRole('checkbox').filter(checkbox => checkbox.getAttribute('aria-label')?.startsWith('Seleccionar operación'));
    await userEvent.click(checkboxes[0]);
    await userEvent.click(screen.getByRole('button', { name: /devolver seleccionadas/i }));

    const confirmButton = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmButton).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Indique qué información debe corregirse o completarse.'), 'Falta checklist.');
    await userEvent.click(confirmButton);

    expect(onBulkReturn).toHaveBeenCalledWith(['REV-1001'], { user: 'Administrador OCC', reason: 'Falta checklist.' });
  });

  it('opens the detail drawer, approves from it, and closes it', async () => {
    const onApprove = vi.fn().mockResolvedValue({});
    renderPage({ onApprove });

    await userEvent.click(screen.getByText('DM161'));
    expect(screen.getByTestId('review-detail-drawer')).toBeInTheDocument();

    await userEvent.click(within(screen.getByTestId('review-detail-drawer')).getByRole('button', { name: 'Aprobar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onApprove).toHaveBeenCalledWith('REV-1001', { user: 'Administrador OCC' });
    expect(screen.queryByTestId('review-detail-drawer')).not.toBeInTheDocument();
  });

  it('opens the detail drawer, returns with a reason from it, and closes it', async () => {
    const onReturn = vi.fn().mockResolvedValue({});
    renderPage({ onReturn });

    await userEvent.click(screen.getByText('DM161'));
    await userEvent.click(
      within(screen.getByTestId('review-detail-drawer')).getByRole('button', { name: /devolver con correcciones/i })
    );
    await userEvent.type(
      screen.getByPlaceholderText('Indique qué información debe corregirse o completarse.'),
      'Falta la firma del representante de la aerolínea.'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(onReturn).toHaveBeenCalledWith('REV-1001', {
      user: 'Administrador OCC',
      reason: 'Falta la firma del representante de la aerolínea.',
    });
    expect(screen.queryByTestId('review-detail-drawer')).not.toBeInTheDocument();
  });
});