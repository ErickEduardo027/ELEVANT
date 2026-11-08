import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from '../../../tests/MemoryRouter.jsx';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { DepartmentAccessProvider } from '../access/DepartmentAccessContext';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(), queue: vi.fn(), detail: vi.fn(), decide: vi.fn(),
  history: vi.fn(), submission: vi.fn(), reopen: vi.fn(),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../../services/occReviewService', () => ({
  loadOccReviewQueue: mocks.queue,
  loadOccReviewDetail: mocks.detail,
  loadOccReviewSubmissionHistory: mocks.history,
  loadOccReviewSubmissionDetail: mocks.submission,
  decideOccReview: mocks.decide,
  reopenOccReview: mocks.reopen,
}));

vi.mock('./components/OperationDocumentsSection', () => ({ default: () => null }));
// 3-G: the live incidents panel has its own tests; here it shows which operation it reads and its live token.
vi.mock('../incidents/OperationIncidentsPanel', () => ({
  default: ({ operationId, refreshToken }) => (
    <div data-testid="incidents-panel" data-operation={operationId} data-refresh={String(refreshToken)} />
  ),
}));
const live = vi.hoisted(() => ({ listener: null, start: vi.fn(async () => {}), stop: vi.fn(async () => {}) }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: listener => {
    live.listener = listener;
    return { start: live.start, stop: live.stop };
  },
}));

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
  checklistAnswers: [{ section: 'Puente', code: 'BRIDGE', label: 'Verificado', value: 'NotOk', note: null }],
  services: [{ id: '70000000-0000-0000-0000-000000000018', code: 'GPU', name: 'GPU',
    status: 'Completed', contractedQuantity: 1, executedQuantity: 1, unit: 'operation' }],
  incidents: [{ id: '70000000-0000-0000-0000-000000000019', type: 'Safety',
    severity: 'High', status: 'Open', description: 'Detalle visible', occurredAt: '2026-09-23T14:00:00Z' }],
  decision: null, reviewVersion: '"strong-token"',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function renderRoute(initial = '/admin-occ/review', access = null) {
  const route = <MemoryRouter initialEntries={[initial]}><CanonicalReviewRoute /></MemoryRouter>;
  return render(access
    ? <DepartmentAccessProvider initialAccess={access} observe={false}>{route}</DepartmentAccessProvider>
    : route);
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
    // 3-H: the decision carries its intent's Idempotency-Key.
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith(operationId,
      { submissionId, outcome: 'Approved' }, detail.reviewVersion,
      expect.objectContaining({ signal: expect.any(AbortSignal), idempotencyKey: expect.stringMatching(UUID) })));
    expect(await screen.findByText('Entrega aprobada y registrada.')).toBeInTheDocument();
  });

  it('shows every evidence code in Spanish, never as the raw enum (3-N22)', async () => {
    const user = userEvent.setup();
    renderRoute();
    await user.click(await screen.findByRole('button', { name: 'Ver detalle' }));
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    await within(panel).findByText(/Detalle visible/);
    const evidence = within(panel).getByRole('region', { name: 'Servicios ejecutados' });
    expect(within(evidence).getByText('1 / 1 por operación', { exact: false })).toBeInTheDocument();
    expect(within(evidence).getByText(/Completado/)).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Checklist · Enviado' })).toBeInTheDocument();
    expect(within(panel).getByText('No conforme')).toBeInTheDocument();
    expect(within(panel).getByText('Seguridad · Alta')).toBeInTheDocument();
    expect(within(panel).getByText(/· Abierta/)).toBeInTheDocument();
    expect(within(panel).queryByText(/Submitted|NotOk|Safety/)).not.toBeInTheDocument();
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

describe('CanonicalReviewRoute incidents, Service Order and reopening (phase 3, block D)', () => {
  const detailRoute = `/admin-occ/review?operationId=${operationId}`;

  it('keeps the live incidents next to the ones frozen at the hand-off (3-G)', async () => {
    renderRoute(detailRoute);
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByRole('heading', { name: 'Incidencias al entregar (1)' })).toBeInTheDocument();
    expect(within(panel).getByTestId('incidents-panel')).toHaveAttribute('data-operation', operationId);
  });

  it('shows an operation still on the ramp and its incidents when there is no hand-off yet (3-G)', async () => {
    mocks.detail.mockRejectedValue(Object.assign(new Error('La operación ya no está disponible en su estación.'),
      { status: 404, code: 'not-found' }));
    renderRoute(detailRoute);
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByText('La operación sigue en curso; aún no hay entrega.')).toBeInTheDocument();
    expect(within(panel).getByText('Puede gestionar sus incidencias mientras el agente trabaja.')).toBeInTheDocument();
    expect(within(panel).getByTestId('incidents-panel')).toHaveAttribute('data-operation', operationId);
    expect(within(panel).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  });

  it('approves only a signed Service Order or its correction by OCC (3-N02)', async () => {
    mocks.detail.mockResolvedValueOnce({ ...detail, serviceOrderState: 'Unsigned' });
    const view = renderRoute(detailRoute);
    let panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByText('Sin firmar')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Aprobar' })).toBeDisabled();
    expect(within(panel).getByText('La Orden de Servicio debe estar firmada: devuélvala a rampa para firmar de nuevo.'))
      .toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Devolver con correcciones' })).toBeEnabled();
    view.unmount();

    mocks.detail.mockResolvedValueOnce({ ...detail, serviceOrderState: 'Stale' });
    const stale = renderRoute(detailRoute);
    panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByText('Firma desactualizada')).toBeInTheDocument();
    expect(within(panel).getByText(/cambió después de la firma: devuélvala a rampa/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Aprobar' })).toBeDisabled();
    stale.unmount();

    mocks.detail.mockResolvedValueOnce({ ...detail, serviceOrderState: 'Corrected' });
    renderRoute(detailRoute);
    panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByText('Corregida por OCC')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Aprobar' })).toBeEnabled();
  });

  it('explains a decision refused by its code and re-reads (3-N02)', async () => {
    const user = userEvent.setup();
    mocks.decide.mockRejectedValueOnce(Object.assign(
      new Error('La Orden de Servicio debe estar firmada: devuélvala a rampa para firmar de nuevo.'),
      { status: 409, code: 'service_order_unsigned' }));
    renderRoute(detailRoute);
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    await within(panel).findByText(/Detalle visible/);
    await user.click(within(panel).getByRole('button', { name: 'Aprobar' }));
    await user.click(within(panel).getByRole('button', { name: 'Confirmar decisión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La Orden de Servicio debe estar firmada');
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
  });

  it('a reopened revision says why and is approved in OCC, never returned to the ramp (3-H)', async () => {
    mocks.detail.mockResolvedValueOnce({ ...detail, revisionNumber: 3, serviceOrderState: 'Signed',
      reopening: { fromRevisionNumber: 2, reason: 'La aerolínea disputó el GPU', reopenedAt: '2026-09-23T18:00:00Z',
        reopenedBy: 'Alex Operations' } });
    renderRoute(detailRoute);
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByText('Revisión reabierta por OCC: La aerolínea disputó el GPU')).toBeInTheDocument();
    expect(within(panel).getByText(/Alex Operations · .* · desde la revisión 2/)).toBeInTheDocument();
    expect(within(panel).getByText('Una revisión reabierta no vuelve a rampa: corríjala aquí y apruébela.'))
      .toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Devolver con correcciones' })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Aprobar' })).toBeEnabled();
  });

  it('reopens an approval with the permission and re-reads; an invoiced one explains the credit note (3-H)', async () => {
    const user = userEvent.setup();
    const approved = { ...detail, status: 'Approved', serviceOrderState: 'Signed',
      decision: { outcome: 'Approved', reason: null, decidedAt: detail.submittedAt } };
    mocks.detail.mockResolvedValue(approved);
    mocks.reopen.mockResolvedValueOnce({ operationId, submissionId: '70000000-0000-0000-0000-000000000021',
      revisionNumber: 3, status: 'PendingReview', reviewVersion: '"reopened-token"' })
      .mockRejectedValueOnce(Object.assign(new Error('Ya hay servicios facturados: corrija con una nota de crédito.'),
        { status: 409, code: 'already_invoiced' }));
    const reopener = { kind: 'Member', permissions: ['operations.review.read', 'operations.review.reopen'] };
    const view = renderRoute(detailRoute, reopener);
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(within(panel).queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
    await user.click(await within(panel).findByRole('button', { name: 'Reabrir revisión' }));
    await user.type(within(panel).getByLabelText('Motivo de la reapertura (8 a 2000 caracteres)'),
      'La aerolínea disputó el GPU');
    await user.click(within(panel).getByRole('button', { name: 'Confirmar reapertura' }));
    await waitFor(() => expect(mocks.reopen).toHaveBeenCalledWith(operationId,
      { submissionId, reason: 'La aerolínea disputó el GPU' }, detail.reviewVersion, expect.stringMatching(UUID)));
    expect(await screen.findByText('Revisión reabierta como revisión 3: vuelve a Pendiente de revisión.'))
      .toBeInTheDocument();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));

    await user.click(await within(panel).findByRole('button', { name: 'Reabrir revisión' }));
    await user.type(within(panel).getByLabelText('Motivo de la reapertura (8 a 2000 caracteres)'),
      'La aerolínea disputó el GPU otra vez');
    await user.click(within(panel).getByRole('button', { name: 'Confirmar reapertura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay servicios facturados: corrija con una nota de crédito.');
    view.unmount();

    renderRoute(detailRoute);
    const withoutPermission = await screen.findByRole('region', { name: 'Detalle de entrega' });
    await within(withoutPermission).findByText(/Detalle visible/);
    expect(within(withoutPermission).queryByRole('button', { name: 'Reabrir revisión' })).not.toBeInTheDocument();
  });
});

describe('CanonicalReviewRoute live re-reads (3-N23)', () => {
  const accountId = '40000000-0000-7000-8000-000000000001';
  beforeEach(() => {
    live.listener = null;
    mocks.useAuth.mockReturnValue({ session: { accountId, stationScopes: [{ stationId, stationCode: 'PUJ' }] } });
  });

  it('shows a new hand-off when occ_review is announced, without the loading state', async () => {
    mocks.queue.mockResolvedValueOnce({ ...queue, operations: [] });
    renderRoute();
    expect(await screen.findByText('No hay entregas para revisar en esta estación.')).toBeInTheDocument();
    await waitFor(() => expect(live.listener).toBeTypeOf('function'));
    act(() => live.listener(['notifications']));
    expect(mocks.queue).toHaveBeenCalledTimes(1);
    act(() => live.listener(['occ_review']));
    expect(screen.queryByText('Cargando entregas de la estación…')).not.toBeInTheDocument();
    expect(await screen.findByText('DEV-TAT-001')).toBeInTheDocument();
    expect(mocks.queue).toHaveBeenCalledTimes(2);
  });

  it('keeps a prepared decision on the same version and discards it when the hand-off changed', async () => {
    const user = userEvent.setup();
    renderRoute(`/admin-occ/review?operationId=${operationId}`);
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    await within(panel).findByText(/Detalle visible/);
    await user.click(within(panel).getByRole('button', { name: 'Devolver con correcciones' }));
    await user.type(within(panel).getByRole('textbox', { name: /Correcciones necesarias/ }), 'Falta la foto del daño');

    act(() => live.listener(['occ_review']));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(within(panel).getByRole('textbox', { name: /Correcciones necesarias/ })).toHaveValue('Falta la foto del daño');

    mocks.detail.mockResolvedValueOnce({ ...detail, reviewVersion: '"changed-token"' });
    act(() => live.listener(['occ_review']));
    expect(await screen.findByText('La entrega cambió; revise antes de confirmar.')).toBeInTheDocument();
    expect(within(panel).queryByRole('textbox', { name: /Correcciones necesarias/ })).not.toBeInTheDocument();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('re-reads the live incidents panel with each occ_review announcement (3-G, 3-N23)', async () => {
    renderRoute(`/admin-occ/review?operationId=${operationId}`);
    const panel = await screen.findByRole('region', { name: 'Detalle de entrega' });
    expect(await within(panel).findByTestId('incidents-panel')).toHaveAttribute('data-refresh', '0');
    await waitFor(() => expect(live.listener).toBeTypeOf('function'));
    act(() => live.listener(['occ_review']));
    await waitFor(() => expect(within(panel).getByTestId('incidents-panel')).toHaveAttribute('data-refresh', '1'));
  });

  it('stops listening when the screen closes', async () => {
    const view = renderRoute();
    await screen.findByText('DEV-TAT-001');
    await waitFor(() => expect(live.start).toHaveBeenCalled());
    view.unmount();
    expect(live.stop).toHaveBeenCalled();
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
