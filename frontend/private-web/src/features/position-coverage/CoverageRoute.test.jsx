import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render as renderView, screen, waitFor, within } from '@testing-library/react';
import CoverageRoute from './CoverageRoute';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { administratorAccess, DepartmentAccessProvider } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import { createOccShellValue, OccShellTestProvider } from '../admin-occ/shell/testing/occShellFixtures';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { createOccCoverage, loadOccCoverage, releaseOccCoverage, updateOccStandAttributes } from '../../services/occCoverageService';

const stationId = '20000000-0000-0000-0000-000000000003';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: [{ stationId, stationCode: 'PUJ' }] } }) }));
// A spy: the page must not open an observer of its own (contratos 2.7).
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: vi.fn(() => ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../services/occCoverageService', async importOriginal => ({
  ...(await importOriginal()),
  loadOccCoverage: vi.fn(), createOccCoverage: vi.fn(), releaseOccCoverage: vi.fn(), updateOccStandAttributes: vi.fn(),
}));

const terminalA = { terminalId: 't-a', code: 'A', name: 'Terminal A', maxStandsPerAgent: 3, requiresBridgeQualification: false };
const terminalB = { terminalId: 't-b', code: 'B', name: 'Terminal B', maxStandsPerAgent: 2, requiresBridgeQualification: true };
const stand = (code, terminalId, extra = {}) => ({ standId: `s-${code}`, code, terminalId, isActive: true, hasBoardingBridge: false,
  isRemote: false, maxAircraftSize: null, coveredBy: [], version: `v-${code}`, ...extra });
const agent = { agentId: 'ag-1', name: 'Riley Ramp', employeeNumber: 'DEV-RA-001', terminalId: 't-a', terminalCode: 'A',
  shiftStartsAt: '2026-08-19T10:00:00Z', shiftEndsAt: '2026-08-19T18:00:00Z', isJunior: true, hasAirportPermit: true,
  hasDriverLicense: false, hasBridgeQualification: false, isAbsent: false };
const board = { stationId, stationCode: 'PUJ', date: '2026-08-19', canAssign: true, canConfigure: true,
  terminals: [terminalA, terminalB], stands: [stand('A01', 't-a'), stand('A02', 't-a'), stand('B01', 't-b', { hasBoardingBridge: true })],
  constraints: [], agents: [agent], coverages: [] };

// Every case renders inside the OCC frame, whose shell channel brings the feed's announcements (contratos 2.7).
let shell;
beforeEach(() => { shell = createOccShellValue(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function InFrame({ children }) {
  return <OccShellTestProvider value={shell}>{children}</OccShellTestProvider>;
}
const render = ui => renderView(ui, { wrapper: InFrame });

it('assigns stands to an agent and explains every broken rule in Spanish', async () => {
  loadOccCoverage.mockResolvedValue(board);
  createOccCoverage.mockRejectedValueOnce(Object.assign(new Error('La cobertura no cumple las reglas de asignación.'),
    { status: 422, reasons: ['mentor_required'] }));
  render(<CoverageRoute />);
  const form = await screen.findByRole('form', { name: 'Asignar posiciones' });
  fireEvent.change(within(form).getByLabelText('Agente'), { target: { value: 'ag-1' } });
  expect(within(form).getByText('Menos de 3 meses: va con mentor')).toBeInTheDocument();
  fireEvent.click(within(form).getByRole('button', { name: 'A01' }));
  fireEvent.click(within(form).getByRole('button', { name: 'A02' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  expect(await screen.findByText(/necesita un mentor experimentado/)).toBeInTheDocument();
  expect(createOccCoverage).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'ag-1', terminalId: 't-a',
    standIds: ['s-A01', 's-A02'], isReinforcement: false }), { idempotencyKey: expect.any(String) });

  const covered = { ...board, stands: [stand('A01', 't-a', { coveredBy: ['Riley Ramp'] }), ...board.stands.slice(1)],
    coverages: [{ id: 'cv-1', agentId: 'ag-1', agentName: 'Riley Ramp', terminalId: 't-a', terminalCode: 'A',
      stands: [{ standId: 's-A01', code: 'A01' }], startsAt: '2026-08-19T10:00:00Z', endsAt: '2026-08-19T18:00:00Z',
      mentorAgentId: null, mentorName: null, vehicleCode: null, isReinforcement: false }] };
  createOccCoverage.mockResolvedValueOnce(covered);
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  const day = await screen.findByRole('region', { name: 'Coberturas del día' });
  expect(await within(day).findByText('Riley Ramp')).toBeInTheDocument();
  releaseOccCoverage.mockResolvedValueOnce(board);
  fireEvent.click(within(day).getByRole('button', { name: 'Liberar' }));
  expect(releaseOccCoverage).toHaveBeenCalledWith('cv-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    { idempotencyKey: expect.any(String) });
});

it('retries an uncertain coverage with the same key and re-reads the board on a conflict (3-J)', async () => {
  loadOccCoverage.mockResolvedValue(board);
  createOccCoverage
    .mockRejectedValueOnce(Object.assign(new Error('No fue posible completar la acción. Intenta de nuevo.'), { status: null }))
    .mockRejectedValueOnce(Object.assign(new Error('Ese envío ya se usó con otros datos.'), { status: 409,
      code: 'idempotency_conflict', reasons: [] }))
    .mockResolvedValueOnce(board);
  render(<CoverageRoute />);
  const form = await screen.findByRole('form', { name: 'Asignar posiciones' });
  fireEvent.change(within(form).getByLabelText('Agente'), { target: { value: 'ag-1' } });
  fireEvent.click(within(form).getByRole('button', { name: 'A01' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  expect(await screen.findByText('No fue posible completar la acción. Intenta de nuevo.')).toBeInTheDocument();
  // The same coverage after an answer that never came: the same key, so the server never covers twice.
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  expect(await screen.findByText('Ese envío ya se usó con otros datos.')).toBeInTheDocument();
  const [first, second] = createOccCoverage.mock.calls.map(call => call[1].idempotencyKey);
  expect(second).toBe(first);
  // A conflict settles the intent and the board is read again; the next attempt is a new intent.
  await waitFor(() => expect(loadOccCoverage).toHaveBeenCalledTimes(2));
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  await waitFor(() => expect(createOccCoverage).toHaveBeenCalledTimes(3));
  expect(createOccCoverage.mock.calls[2][1].idempotencyKey).not.toBe(first);
});

it('says when the account cannot see the coverage instead of offering a retry', async () => {
  loadOccCoverage.mockRejectedValue(Object.assign(new Error('Tu acceso no permite gestionar la cobertura de posiciones.'),
    { status: 403 }));
  render(<CoverageRoute />);
  // The no-permission state of OccRemoteView: one plain sentence, no alert and no retry.
  expect(await screen.findByText('Tu acceso no permite ver la cobertura de posiciones de esta estación.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
});

it('switches terminals and shows the bridge stands of terminal B', async () => {
  loadOccCoverage.mockResolvedValue(board);
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Terminal B' }));
  const stands = screen.getByRole('region', { name: 'Posiciones de la terminal' });
  expect(within(stands).getByText('B01')).toBeInTheDocument();
  expect(within(stands).getByText('Puente')).toBeInTheDocument();
  expect(screen.getByText(/exige habilitación de puente/)).toBeInTheDocument();
});

it('explains in Configuración why a stand in use stays active, and where new stands are created (2-A)', async () => {
  const { translateCoverageError } = await vi.importActual('../../services/occCoverageService');
  loadOccCoverage.mockResolvedValue(board);
  updateOccStandAttributes.mockRejectedValueOnce(translateCoverageError({ status: 422, code: 'stand_in_use',
    reasons: ['stand_in_use'] }));
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configuración' }));
  const stands = screen.getByRole('region', { name: 'Atributos de las posiciones' });
  const row = within(stands).getByText('A01').closest('tr');
  fireEvent.click(within(row).getByLabelText('Activa'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await within(row).findByRole('alert')).toHaveTextContent('La posición tiene vuelos sin terminar o coberturas abiertas');
  // The change carries the stand's version on the board and the intent's key (2-A).
  expect(updateOccStandAttributes).toHaveBeenCalledWith('s-A01', expect.objectContaining({ isActive: false,
    expectedVersion: 'v-A01' }), expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('keeps the key of an uncertain stand change and reads the board again when the stand changed meanwhile (2-A)', async () => {
  const { STAND_PROBLEM_MESSAGES, translateCoverageError } = await vi.importActual('../../services/occCoverageService');
  const renamed = { ...board, stands: [stand('A01', 't-a', { version: 'v-A01-b' }), ...board.stands.slice(1)] };
  loadOccCoverage.mockResolvedValueOnce(board).mockResolvedValueOnce(renamed);
  updateOccStandAttributes.mockRejectedValueOnce(Object.assign(new Error('No fue posible completar la acción. Intenta de nuevo.'),
    { status: null, reasons: [] }))
    .mockRejectedValueOnce(translateCoverageError({ status: 409, code: 'version_conflict' }, STAND_PROBLEM_MESSAGES));
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configuración' }));
  const stands = screen.getByRole('region', { name: 'Atributos de las posiciones' });
  const row = within(stands).getByText('A01').closest('tr');
  fireEvent.click(within(row).getByLabelText('Remota'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await within(row).findByRole('alert')).toHaveTextContent('No fue posible completar la acción');
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  // The stand changed in «Datos maestros»: the message stays while the board is read again with its new version.
  expect(await screen.findByText(/La posición cambió mientras la editabas, aquí o en «Datos maestros»/)).toBeInTheDocument();
  await waitFor(() => expect(loadOccCoverage).toHaveBeenCalledTimes(2));
  const [first, second] = updateOccStandAttributes.mock.calls;
  expect(second[2]).toBe(first[2]);
  expect(second[1]).toEqual({ date: expect.any(String), hasBoardingBridge: false, isRemote: true, maxAircraftSize: null,
    isActive: true, expectedVersion: 'v-A01' });
  expect(screen.queryByText(/data changed/i)).not.toBeInTheDocument();
});

it('explains why a stand of an inactive terminal is not reactivated from Configuración (2-A)', async () => {
  const { translateCoverageError } = await vi.importActual('../../services/occCoverageService');
  loadOccCoverage.mockResolvedValue({ ...board, stands: [stand('A01', 't-a', { isActive: false }), ...board.stands.slice(1)] });
  updateOccStandAttributes.mockRejectedValueOnce(translateCoverageError({ status: 422, code: 'terminal_inactive',
    reasons: ['terminal_inactive'] }));
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configuración' }));
  const row = within(screen.getByRole('region', { name: 'Atributos de las posiciones' })).getByText('A01').closest('tr');
  fireEvent.click(within(row).getByLabelText('Activa'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await within(row).findByRole('alert')).toHaveTextContent('La terminal de esta posición está desactivada');
});

it('says where terminals are created when the station has none active', async () => {
  loadOccCoverage.mockResolvedValue({ ...board, terminals: [], stands: [] });
  render(<CoverageRoute />);
  expect(await screen.findByText(/La estación no tiene terminales activas. OCC las crea en «Datos maestros»./)).toBeInTheDocument();
});

it('marks absent or permitless mentors and explains the mentor rules of 2-N23', async () => {
  const absentMentor = { ...agent, agentId: 'ag-2', name: 'Mateo Ramp', isJunior: false, isAbsent: true };
  const permitless = { ...agent, agentId: 'ag-3', name: 'Lucía Ramp', isJunior: false, hasAirportPermit: false };
  const fit = { ...agent, agentId: 'ag-4', name: 'Pedro Ramp', isJunior: false };
  loadOccCoverage.mockResolvedValue({ ...board, agents: [agent, absentMentor, permitless, fit] });
  createOccCoverage.mockRejectedValueOnce(Object.assign(new Error('La cobertura no cumple las reglas de asignación.'),
    { status: 422, reasons: ['mentor_absent', 'mentor_permit_required'] }));
  render(<CoverageRoute />);
  const form = await screen.findByRole('form', { name: 'Asignar posiciones' });
  fireEvent.change(within(form).getByLabelText('Agente'), { target: { value: 'ag-1' } });
  const mentor = within(form).getByLabelText('Mentor');
  expect(within(mentor).getByRole('option', { name: 'Mateo Ramp · ausencia aprobada' })).toBeDisabled();
  expect(within(mentor).getByRole('option', { name: 'Lucía Ramp · carnet vencido' })).toBeDisabled();
  expect(within(mentor).getByRole('option', { name: 'Pedro Ramp' })).not.toBeDisabled();
  fireEvent.change(mentor, { target: { value: 'ag-4' } });
  fireEvent.click(within(form).getByRole('button', { name: 'A01' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  // The server still decides: a mentor who became absent meanwhile is explained in Spanish.
  expect(await screen.findByText('El mentor tiene una ausencia aprobada ese día.')).toBeInTheDocument();
  expect(screen.getByText('El mentor no tiene el carnet aeroportuario vigente.')).toBeInTheDocument();
});

it('offers Reintentar when the board cannot be read, with the service\'s own sentence', async () => {
  loadOccCoverage.mockRejectedValueOnce(Object.assign(new Error('No fue posible completar la acción. Intenta de nuevo.'),
    { status: 500, reasons: [] })).mockResolvedValueOnce(board);
  render(<CoverageRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible completar la acción. Intenta de nuevo.');
  expect(screen.queryByRole('navigation', { name: 'Terminal y vista' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('form', { name: 'Asignar posiciones' })).toBeInTheDocument();
  expect(loadOccCoverage).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('switches terminal and view with segmented buttons inside the «Terminal y vista» navigation', async () => {
  loadOccCoverage.mockResolvedValue(board);
  const access = administratorAccess('operations', DepartmentPermissionCodes.operations);
  render(<DepartmentAccessProvider initialAccess={access} observe={false}><CoverageRoute /></DepartmentAccessProvider>);
  const nav = await screen.findByRole('navigation', { name: 'Terminal y vista' });
  const terminals = within(nav).getByRole('group', { name: 'Terminal' });
  const views = within(nav).getByRole('group', { name: 'Vista' });
  // The cycle E2E and the guide press «Terminal A» by its exact name inside this navigation.
  expect(within(terminals).getAllByRole('button').map(button => button.textContent)).toEqual(['Terminal A', 'Terminal B']);
  expect(within(terminals).getByRole('button', { name: 'Terminal A' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(views).getByRole('button', { name: 'Cobertura' })).toHaveAttribute('aria-pressed', 'true');
  // The page title sits on its own line, with the date as the toolbar's control; no subtitle and no station badge
  // (the station is in the frame's status bar). What the module does is said where it is empty: «Coberturas del día».
  const title = screen.getByRole('heading', { level: 1, name: 'Cobertura de posiciones' });
  expect(within(screen.getByRole('toolbar', { name: 'Cobertura de posiciones' })).getByLabelText('Fecha')).toHaveAttribute('type', 'date');
  expect(title.closest('[data-occ-toolbar]')).not.toHaveTextContent(/Qué agente cubre/);
  expect(within(screen.getByRole('region', { name: 'Coberturas del día' }))
    .getByText(/Qué agente cubre cada posición durante su turno/)).toBeInTheDocument();
  expect(screen.queryByText('Punta Cana International Airport')).toBeNull();

  fireEvent.click(within(terminals).getByRole('button', { name: 'Terminal B' }));
  expect(within(terminals).getByRole('button', { name: 'Terminal B' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(terminals).getByRole('button', { name: 'Terminal A' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('region', { name: 'Posiciones de la terminal' })).toHaveTextContent('Terminal B');
  expect(screen.getByRole('region', { name: 'Asignar posiciones' })).toHaveTextContent('Terminal B');

  fireEvent.click(within(views).getByRole('button', { name: 'Configuración' }));
  expect(within(views).getByRole('button', { name: 'Configuración' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(views).getByRole('button', { name: 'Cobertura' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('region', { name: 'Reglas de la terminal' })).toHaveTextContent('Terminal B');
  const attributes = screen.getByRole('region', { name: 'Atributos de las posiciones' });
  expect(within(attributes).getByRole('link', { name: 'Datos maestros' })).toHaveAttribute('href', '/admin-occ/master-data');
  expect(screen.queryByRole('form', { name: 'Asignar posiciones' })).toBeNull();
  // Both choices are the screen's own: nothing is read again.
  expect(loadOccCoverage).toHaveBeenCalledTimes(1);
});

it('offers no «Configuración» to an account that only reads the coverage', async () => {
  loadOccCoverage.mockResolvedValue({ ...board, canAssign: false, canConfigure: false });
  render(<CoverageRoute />);
  const nav = await screen.findByRole('navigation', { name: 'Terminal y vista' });
  expect(within(within(nav).getByRole('group', { name: 'Vista' })).getAllByRole('button').map(button => button.textContent))
    .toEqual(['Cobertura']);
  expect(screen.getByText('Tu acceso permite ver la cobertura, no asignarla.')).toBeInTheDocument();
  expect(screen.queryByRole('form', { name: 'Asignar posiciones' })).toBeNull();
});

it('shows the board as a table and the day coverages as a list', async () => {
  const senior = { ...agent, agentId: 'ag-2', name: 'Mateo Ramp', isJunior: false, hasDriverLicense: true,
    hasBridgeQualification: true, hasAirportPermit: false, isAbsent: true };
  loadOccCoverage.mockResolvedValue({ ...board, agents: [agent, senior],
    stands: [stand('A01', 't-a', { coveredBy: ['Riley Ramp'] }), stand('A02', 't-a', { isActive: false }),
      stand('A03', 't-a', { maxAircraftSize: 'Narrowbody' }), stand('A04', 't-a', { hasBoardingBridge: true }),
      ...board.stands.slice(2)],
    coverages: [{ id: 'cv-1', agentId: 'ag-1', agentName: 'Riley Ramp', terminalId: 't-a', terminalCode: 'A',
      stands: [{ standId: 's-A01', code: 'A01' }, { standId: 's-A03', code: 'A03' }],
      startsAt: '2026-08-19T10:00:00Z', endsAt: '2026-08-19T18:00:00Z', mentorAgentId: 'ag-2', mentorName: 'Mateo Ramp',
      vehicleCode: 'VH-07', isReinforcement: true }] });
  render(<CoverageRoute />);

  // The terminal's stands: a table of four columns, none of them called «Puente».
  const standsRegion = await screen.findByRole('region', { name: 'Posiciones de la terminal' });
  const table = within(standsRegion).getByRole('table', { name: 'Posiciones de la terminal' });
  expect(within(table).getAllByRole('columnheader').map(header => header.textContent))
    .toEqual(['Posición', 'Atributos', 'Cubierta por', 'Estado']);
  const rowOf = code => within(table).getByText(code).closest('tr');
  expect(rowOf('A01').querySelector('[data-occ-plate="stand"]')).toHaveTextContent('A01');
  expect(rowOf('A01')).toHaveTextContent('Riley Ramp');
  expect(rowOf('A02').querySelector('[data-occ-status]')).toHaveAttribute('data-tone', 'muted');
  expect(rowOf('A02')).toHaveTextContent('Desactivada');
  // An attribute is a word with its glyph, never an alarm: «Estrecho» is no longer amber.
  expect(within(rowOf('A03')).getByText('Estrecho').closest('[data-occ-status]')).toHaveAttribute('data-tone', 'neutral');
  expect(within(rowOf('A04')).getByText('Puente').closest('[data-occ-status]')).toHaveAttribute('data-tone', 'neutral');
  expect(rowOf('A04')).toHaveTextContent('Sin agente');
  // A normal stand says nothing in «Estado».
  expect(rowOf('A01').querySelector('[data-occ-status]')).toBeNull();

  // The coverages of the day: one item per agent, with its stands as plates and its window in the identifiers' face.
  const day = screen.getByRole('region', { name: 'Coberturas del día' });
  const [item] = within(within(day).getByRole('list', { name: 'Coberturas del día' })).getAllByRole('listitem');
  expect(within(item).getByText('Riley Ramp').tagName).toBe('STRONG');
  expect(within(item).getByText('Refuerzo').closest('[data-occ-status]')).toHaveAttribute('data-tone', 'neutral');
  expect([...item.querySelectorAll('[data-occ-plate="stand"]')].map(plate => plate.textContent)).toEqual(['A01', 'A03']);
  expect(within(item).getByText('06:00–14:00').closest('.font-mono')).not.toBeNull();
  expect(item).toHaveTextContent('Mateo Ramp');
  expect(item.querySelector('[data-occ-plate="code"]')).toHaveTextContent('VH-07');
  expect(within(item).getByRole('button', { name: 'Liberar' })).toBeInTheDocument();

  // The form: «Agente» by its exact name, the stands by their code (the bridge mark only describes them), and what
  // blocks a coverage asks for attention, never urgency.
  const form = screen.getByRole('form', { name: 'Asignar posiciones' });
  expect(within(form).getByRole('combobox', { name: 'Agente' })).toBeRequired();
  const bridgeStand = within(form).getByRole('button', { name: 'A04' });
  expect(bridgeStand).toHaveAccessibleDescription('con puente');
  expect(bridgeStand).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(bridgeStand);
  expect(bridgeStand).toHaveAttribute('aria-pressed', 'true');
  expect(within(form).getByText('Posiciones (1/3)')).toBeInTheDocument();
  fireEvent.change(within(form).getByLabelText('Agente'), { target: { value: 'ag-2' } });
  const conditions = within(form).getByRole('list', { name: 'Condiciones del agente' });
  const toneOf = text => within(conditions).getByText(text).closest('[data-occ-status]').dataset.tone;
  expect(toneOf('Carnet aeroportuario vencido')).toBe('attention');
  expect(toneOf('Ausencia aprobada')).toBe('attention');
  expect(toneOf('Licencia de conducir')).toBe('active');
  expect(toneOf('Habilitado en puente')).toBe('active');
  expect(conditions.querySelector('[data-tone="urgent"]')).toBeNull();
  expect(within(form).getByRole('button', { name: 'Asignar posiciones' })).toBeEnabled();
});

it('shows in the header of each board the legend of the marks it draws (contratos 2.4)', async () => {
  loadOccCoverage.mockResolvedValue({ ...board,
    stands: [stand('A01', 't-a', { hasBoardingBridge: true }), stand('A02', 't-a', { maxAircraftSize: 'Narrowbody' }),
      stand('A03', 't-a', { isActive: false }), ...board.stands.slice(2)],
    coverages: [{ id: 'cv-1', agentId: 'ag-1', agentName: 'Riley Ramp', terminalId: 't-a', terminalCode: 'A',
      stands: [{ standId: 's-A01', code: 'A01' }], startsAt: '2026-08-19T10:00:00Z', endsAt: '2026-08-19T18:00:00Z',
      mentorAgentId: null, mentorName: null, vehicleCode: null, isReinforcement: true }] });
  render(<CoverageRoute />);
  const shapeOf = element => element.querySelector('svg').dataset.shape;
  const entriesOf = legend => within(legend).getAllByRole('listitem')
    .map(item => [item.textContent, item.dataset.tone, shapeOf(item)]);

  // «Posiciones de la terminal»: the legend sits in the board's header, beside its title, with the board's two shapes
  // in order: the hollow circle of an attribute, then the slashed circle of a deactivated stand.
  const stands = await screen.findByRole('region', { name: 'Posiciones de la terminal' });
  const legend = within(stands).getByRole('list', { name: 'Atributos y estado' });
  expect(legend.closest('header')).toContainElement(within(stands).getByRole('heading', { name: 'Posiciones de la terminal' }));
  expect(entriesOf(legend)).toEqual([['Atributo', 'neutral', 'hollow-circle'], ['Desactivada', 'muted', 'slashed-circle']]);
  // Each entry is the shape the board draws for its mark.
  const table = within(stands).getByRole('table', { name: 'Posiciones de la terminal' });
  const pillOf = text => within(table).getByText(text).closest('[data-occ-status]');
  for (const attribute of ['Puente', 'Estrecho']) expect(shapeOf(pillOf(attribute)), attribute).toBe('hollow-circle');
  expect(shapeOf(pillOf('Desactivada'))).toBe('slashed-circle');
  // The legend names the kind of mark: «Puente» stays the only one of the board.
  expect(within(stands).getAllByText('Puente')).toHaveLength(1);

  // «Coberturas del día»: its one mark, «Refuerzo», with the same hollow circle, in its header and not in the list.
  const day = screen.getByRole('region', { name: 'Coberturas del día' });
  const dayLegend = within(day).getByRole('list', { name: 'Tipo de cobertura' });
  expect(dayLegend.closest('header')).toContainElement(within(day).getByRole('heading', { name: 'Coberturas del día' }));
  expect(entriesOf(dayLegend)).toEqual([['Refuerzo', 'neutral', 'hollow-circle']]);
  const items = within(within(day).getByRole('list', { name: 'Coberturas del día' })).getAllByRole('listitem');
  expect(items).toHaveLength(1);
  expect(shapeOf(within(items[0]).getByText('Refuerzo').closest('[data-occ-status]'))).toBe('hollow-circle');
});

it('reads the board again when the frame announces occ_planning, without an observer of its own', async () => {
  // The first read, then the board after another OCC seat covered A01.
  const covered = { ...board, stands: [stand('A01', 't-a', { coveredBy: ['Riley Ramp'] }), ...board.stands.slice(1)] };
  loadOccCoverage.mockResolvedValue(covered).mockResolvedValueOnce(board);
  const view = render(<CoverageRoute />);
  await screen.findByRole('region', { name: 'Posiciones de la terminal' });
  const rowOf = code => within(screen.getByRole('table', { name: 'Posiciones de la terminal' })).getByText(code).closest('tr');
  expect(rowOf('A01')).toHaveTextContent('Sin agente');
  // It listens on the shell's channel, to occ_planning only: the tab's one observer stays the frame's (contratos 2.7).
  expect(shell.subscriptions()).toEqual(['occ_planning']);
  expect(createPrivateWebAccountChangeObserver).not.toHaveBeenCalled();

  // What other modules announce reads nothing here.
  act(() => shell.announce(['mobile_devices', 'operation_messages', 'notifications']));
  expect(loadOccCoverage).toHaveBeenCalledTimes(1);

  // Another OCC seat covered A01: the page reads the day's board again and shows who covers it.
  act(() => shell.announce(['occ_planning']));
  await waitFor(() => expect(rowOf('A01')).toHaveTextContent('Riley Ramp'));
  expect(loadOccCoverage).toHaveBeenCalledTimes(2);
  // The same station and day, read once more.
  const [first, second] = loadOccCoverage.mock.calls;
  expect(first[0]).toBe(stationId);
  expect(second.slice(0, 2)).toEqual(first.slice(0, 2));

  // Leaving the page stops listening.
  view.unmount();
  expect(shell.subscriptions()).toEqual([]);
});

describe('CoverageRoute in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('renders the coverage in English inside the OCC scope', async () => {
    act(() => resetLanguageForTests('en'));
    loadOccCoverage.mockResolvedValue(board);
    render(<LanguageScope><CoverageRoute /></LanguageScope>);
    expect(await screen.findByRole('heading', { level: 1, name: 'Stand coverage' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Terminal and view' });
    expect(within(nav).getByRole('button', { name: 'Terminal A' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: 'Coverage' })).toBeInTheDocument();
    const standsRegion = screen.getByRole('region', { name: 'Terminal stands' });
    const table = within(standsRegion).getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent))
      .toEqual(['Stand', 'Attributes', 'Covered by', 'State']);
    expect(within(table).getAllByText('No agent')).toHaveLength(2);
    // The legends speak English too, with the pills' own words.
    expect(within(within(standsRegion).getByRole('list', { name: 'Attributes and state' })).getAllByRole('listitem')
      .map(item => item.textContent)).toEqual(['Attribute', 'Deactivated']);
    const day = screen.getByRole('region', { name: 'Coverage of the day' });
    expect(within(day).getByRole('list', { name: 'Coverage type' })).toHaveTextContent('Reinforcement');
    expect(within(day).getByText('No agents are assigned in this terminal yet.')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Assign stands' });
    expect(within(form).getByText('Up to 3 per agent. The window is the agent’s whole shift.')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Agent'), { target: { value: 'ag-1' } });
    expect(within(form).getByRole('option', { name: 'Riley Ramp · 06:00–14:00 · under 3 months' })).toBeInTheDocument();
    expect(within(form).getByText('Under 3 months: works with a mentor')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Assign stands' })).toBeDisabled();
    fireEvent.click(within(nav).getByRole('button', { name: 'Configuration' }));
    expect(screen.getByRole('region', { name: 'Stand attributes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeInTheDocument();
    expect(screen.queryByText('Cobertura de posiciones')).toBeNull();
  });
});

it('lists the stands in natural order on the board, the form and each coverage row', async () => {
  const codes = ['A10', 'A01', 'A3', 'A11', 'A02', 'A9'];
  loadOccCoverage.mockResolvedValue({ ...board, stands: codes.map(code => stand(code, 't-a')),
    coverages: [{ id: 'cv-9', agentId: 'ag-1', agentName: 'Riley Ramp', terminalId: 't-a', terminalCode: 'A',
      stands: [{ standId: 's-A10', code: 'A10' }, { standId: 's-A9', code: 'A9' }], startsAt: '2026-08-19T10:00:00Z',
      endsAt: '2026-08-19T18:00:00Z', mentorAgentId: null, mentorName: null, vehicleCode: null, isReinforcement: false }] });
  render(<CoverageRoute />);
  const form = await screen.findByRole('form', { name: 'Asignar posiciones' });
  const natural = ['A01', 'A02', 'A3', 'A9', 'A10', 'A11'];
  expect(within(form).getAllByRole('button').map(button => button.textContent).filter(text => natural.includes(text)))
    .toEqual(natural);
  const day = await screen.findByRole('region', { name: 'Coberturas del día' });
  const row = within(day).getByText('Riley Ramp').closest('[data-occ-row]');
  expect(within(row).getByText('A9').compareDocumentPosition(within(row).getByText('A10')) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
});
