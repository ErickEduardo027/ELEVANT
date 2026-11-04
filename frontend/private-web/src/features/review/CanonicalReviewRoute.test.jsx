import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from '../../../tests/MemoryRouter.jsx';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), queue: vi.fn(), detail: vi.fn(), decide: vi.fn(),
  history: vi.fn(), submission: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../services/occReviewService', () => ({
  loadOccReviewQueue: mocks.queue,
  loadOccReviewDetail: mocks.detail,
  loadOccReviewSubmissionHistory: mocks.history,
  loadOccReviewSubmissionDetail: mocks.submission,
  decideOccReview: mocks.decide,
}));

vi.mock('./components/OperationDocumentsSection', () => ({ default: () => null }));

import CanonicalReviewRoute from './CanonicalReviewRoute';

const stationId = '20000000-0000-0000-0000-000000000001';
const otherStationId = '20000000-0000-0000-0000-000000000002';
const operationId = '70000000-0000-0000-0000-000000000016';
const submissionId = '70000000-0000-0000-0000-000000000017';
const queue = {
  stationId, stationCode: 'PUJ', stationName: 'Punta Cana',
  ianaTimeZone: 'America/Santo_Domingo', hasMore: false,
  operations: [{
    operationId, submissionId, revisionNumber: 2, status: 'PendingReview',
    operationCode: 'DEV-TAT-001', operationDate: '2026-09-23', airlineName: 'Aerolinea',
    agentName: 'Agente Uno', submittedAt: '2026-09-23T15:00:00Z', serviceCount: 1,
    incidentCount: 1,
  }],
};
const detail = {
  ...queue.operations[0], stationId, stationCode: 'PUJ',
  ianaTimeZone: queue.ianaTimeZone,
  plannedStartAt: null, plannedEndAt: null, actualStartAt: null, actualEndAt: null,
  agentNote: 'Sin novedad', checklistStatus: 'Submitted',
  checklistAnswers: [{ section: 'Puente', code: 'BRIDGE', label: 'Verificado', value: 'Yes', note: null }],
  services: [{ id: '70000000-0000-0000-0000-000000000018', code: 'GPU', name: 'GPU',
    status: 'Completed', contractedQuantity: 1, executedQuantity: 1, unit: 'unidad' }],
  incidents: [{ id: '70000000-0000-0000-0000-000000000019', type: 'Safety',
    severity: 'Low', status: 'Open', description: 'Detalle visible', occurredAt: '2026-09-23T14:00:00Z' }],
  decision: null, reviewVersion: '"strong-token"',
};

function renderRoute(initial = '/admin-occ/review') {
  return render(<MemoryRouter initialEntries={[initial]}><CanonicalReviewRoute /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ session: {
    stationScopes: [{ stationId, stationCode: 'PUJ' }],
  } });
  mocks.queue.mockResolvedValue(queue);
  mocks.detail.mockResolvedValue(detail);
  mocks.history.mockResolvedValue({ operationId, hasMore: false,
    submissions: [
      { submissionId, revisionNumber: 2, status: 'PendingReview', submittedAt: detail.submittedAt },
      { submissionId: '70000000-0000-0000-0000-000000000020', revisionNumber: 1,
        status: 'Returned', submittedAt: detail.submittedAt },
    ],
  });
  mocks.submission.mockResolvedValue({ ...detail, revisionNumber: 1, status: 'Returned',
    submissionId: '70000000-0000-0000-0000-000000000020',
    decision: { outcome: 'Returned', reason: 'Falta evidencia anterior', decidedAt: detail.submittedAt },
  });
  mocks.decide.mockResolvedValue({ operationId, submissionId, status: 'Approved', outcome: 'Approved' });
});

describe('CanonicalReviewRoute', () => {
  it('shows no data or command when the session has no station scope', () => {
    mocks.useAuth.mockReturnValue({ session: { stationScopes: [] } });
    renderRoute();
    expect(screen.getByText(/Sin estaciones habilitadas/)).toBeInTheDocument();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it('loads the station queue and canonical evidence then approves after confirmation', async () => {
    const user = userEvent.setup();
    renderRoute();
    expect(await screen.findByText('DEV-TAT-001')).toBeInTheDocument();
    expect(mocks.queue).toHaveBeenCalledWith(stationId, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await user.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByText(/Detalle visible/)).toBeInTheDocument();
    expect(within(panel).getByText(/Verificado/)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Aprobar' }));
    expect(mocks.decide).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole('button', { name: 'Confirmar decisión' }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(operationId,
      { submissionId, outcome: 'Approved' }, detail.reviewVersion,
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(await screen.findByText('Entrega aprobada y registrada.')).toBeInTheDocument();
  });

  it('loads immutable earlier handoff evidence without permitting a decision on it', async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(await screen.findByRole('button', { name: 'Ver detalle' }));
    const history = await screen.findByRole('region', { name: 'Historial de entregas' });
    await user.click(await within(history).findByRole('button', { name: /Revisión 1/ }));
    expect(await within(history).findByText(/Falta evidencia anterior/)).toBeInTheDocument();
    expect(mocks.submission).toHaveBeenCalledWith(operationId,
      '70000000-0000-0000-0000-000000000020',
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(within(history).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('requires a meaningful correction and never sends a bulk decision', async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(await screen.findByRole('button', { name: 'Ver detalle' }));
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    await within(panel).findByText(/Detalle visible/);
    await user.click(within(panel).getByRole('button', { name: 'Devolver con correcciones' }));
    const confirm = within(panel).getByRole('button', { name: 'Confirmar decisión' });
    expect(confirm).toBeDisabled();
    await user.type(within(panel).getByRole('textbox', { name: /Correcciones necesarias/ }), 'Falta');
    expect(confirm).toBeDisabled();
    await user.type(within(panel).getByRole('textbox', { name: /Correcciones necesarias/ }), ' evidencia');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(operationId,
      { submissionId, outcome: 'Returned', reason: 'Falta evidencia' }, detail.reviewVersion,
      expect.any(Object)));
  });

  it('refuses an operation outside the selected station even if it is within the actor scope', async () => {
    const user = userEvent.setup();
    mocks.detail.mockResolvedValue({ ...detail, stationId: otherStationId });
    renderRoute();
    await user.click(await screen.findByRole('button', { name: 'Ver detalle' }));
    expect(await screen.findByText(/La entrega pertenece a otra estación/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('refreshes canonical data after a stale decision instead of automatically retrying', async () => {
    const user = userEvent.setup();
    mocks.decide.mockRejectedValue(new Error('La entrega cambió. Actualiza el detalle antes de decidir.'));
    renderRoute();
    await user.click(await screen.findByRole('button', { name: 'Ver detalle' }));
    await screen.findByText(/Detalle visible/);
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar decisión' }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(mocks.decide).toHaveBeenCalledTimes(1);
  });
});

describe('CanonicalReviewRoute in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('renders the queue, evidence and decision confirmation in English inside the OCC scope', async () => {
    const user = userEvent.setup();
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><MemoryRouter initialEntries={['/admin-occ/review']}><CanonicalReviewRoute /></MemoryRouter></LanguageScope>);
    expect(await screen.findByRole('heading', { name: 'OCC review' })).toBeInTheDocument();
    expect(await screen.findByText('Visible submissions')).toBeInTheDocument();
    expect(screen.getByText('1 services · 1 incidents')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View details' }));
    const panel = await screen.findByRole('region', { name: 'Submission details' });
    expect(await within(panel).findByRole('region', { name: 'Submission history' })).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Return for corrections' }));
    expect(within(panel).getByText('Confirm return of this submission?')).toBeInTheDocument();
    expect(within(panel).getByRole('textbox', { name: /Required corrections/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
    expect(screen.queryByText('Ver detalle')).not.toBeInTheDocument();
  });
});
