import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import EmployeesPage from './EmployeesPage';
import PositionsPage from './PositionsPage';
import RequisitionsPage, { RequisitionCard } from './RequisitionsPage';
import ActivityPanel, { actionLabel } from './ActivityPanel';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import {
  changeRequisitionStatus, createEmployee, getEmployee, getEmployeeOptions, governanceMessage, listEmployees,
  listPositions, listRequisitions, savePosition, terminateEmployee, transferEmployee, updateEmployee,
} from '../../services/humanResourcesEmployeesService';
import { businessToday } from '../../services/businessDay';

vi.mock('../../services/humanResourcesEmployeesService', async importOriginal => ({
  ...(await importOriginal()),
  listEmployees: vi.fn(), getEmployee: vi.fn(), getEmployeeOptions: vi.fn(), createEmployee: vi.fn(),
  terminateEmployee: vi.fn(), listUnregisteredPersons: vi.fn().mockResolvedValue([]), listPositions: vi.fn(),
  savePosition: vi.fn(), listRequisitions: vi.fn(), changeRequisitionStatus: vi.fn(), updateEmployee: vi.fn(),
  transferEmployee: vi.fn(),
}));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); act(() => resetLanguageForTests('es')); });

function renderWith(ui, codes = DepartmentPermissionCodes.humanResources) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('human-resources', codes)}>{ui}</DepartmentAccessProvider>);
}

const station = { id: 'st-1', code: 'PUJ' };
const analyst = { id: 'pos-1', department: 'finance', name: 'Analista de facturación', isRampPosition: false, isActive: true,
  suggestedAccessProfileId: null, suggestedAccessProfileName: null, employees: 1, version: 'P1' };
const options = { identificationTypes: ['CEDULA', 'PASAPORTE', 'RESIDENCIA'], positions: [analyst], stations: [station],
  openRequisitions: [{ id: 'req-1', department: 'finance', position: { id: 'pos-1', name: analyst.name }, quantity: 2,
    filled: 0, reason: 'Temporada', status: 'Open' }] };
const summary = { id: 'emp-1', employeeNumber: 'FIN-010', firstName: 'Lucía', lastName: 'Prueba', department: 'finance',
  position: { id: 'pos-1', name: analyst.name, isRampPosition: false }, status: 'Active', hireDate: '2026-09-01',
  stations: [station], account: { id: 'acc-1', status: 'Active' }, corporateEmail: 'lucia@example.test', requisitionId: null,
  version: 'E1' };

describe('EmployeesPage', () => {
  it('registers an employee against an open requisition', async () => {
    listEmployees.mockResolvedValue({ employees: [], total: 0 });
    getEmployeeOptions.mockResolvedValue(options);
    createEmployee.mockResolvedValue({ id: 'emp-2' });
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar empleado' }));
    const drawer = screen.getByRole('dialog', { name: 'Registrar empleado' });
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Nombre' }), 'Valeria');
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Apellido' }), 'Nueva');
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Número de documento' }), '001-0000001-7');
    await userEvent.type(within(drawer).getByRole('textbox', { name: /Número de empleado/ }), 'fin-020');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Departamento' }), 'finance');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Puesto' }), 'pos-1');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: /requisición/ }), 'req-1');
    await userEvent.click(within(drawer).getByRole('checkbox', { name: 'PUJ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(createEmployee).toHaveBeenCalledWith(expect.objectContaining({ employeeNumber: 'FIN-020', department: 'finance',
      positionId: 'pos-1', requisitionId: 'req-1', stationIds: ['st-1'], corporateEmail: null }));
    expect(await screen.findByText('Empleado registrado.')).toBeInTheDocument();
  });

  it('shows what a termination revokes and sends the record version', async () => {
    listEmployees.mockResolvedValue({ employees: [summary], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    getEmployee.mockResolvedValue({ summary, identificationType: 'CEDULA', identificationNumber: '00100000011',
      identificationIsPlaceholder: false, phoneNumber: null, terminatedOn: null, terminationReason: null, futureShifts: 2,
      pendingAccessRequests: 1, assignments: [{ department: 'finance', position: analyst.name, validFrom: '2026-09-01T00:00:00Z',
        validTo: null, changedBy: 'Camila', reason: 'Alta' }] });
    terminateEmployee.mockResolvedValue({ id: 'emp-1' });
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lucía Prueba' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const modal = screen.getByRole('alertdialog');
    expect(within(modal).getByText(/Su cuenta \(activa\) se desactiva/)).toBeInTheDocument();
    expect(within(modal).getByText(/Se cancelan 1 solicitud/)).toBeInTheDocument();
    expect(within(modal).getByText(/Se quitan sus turnos que aún no empiezan \(tiene 2 desde hoy\)/)).toBeInTheDocument();
    // 2-N31: the proposed date and its limit are AVIAM's day, never the UTC one.
    const day = within(modal).getByLabelText('Fecha de baja');
    expect(day).toHaveValue(businessToday());
    expect(day).toHaveAttribute('max', businessToday());
    await userEvent.type(within(modal).getByRole('textbox', { name: 'Motivo' }), 'Renuncia');
    await userEvent.click(within(modal).getByRole('button', { name: 'Dar de baja' }));
    // The termination carries the intent's Idempotency-Key (2-N06).
    expect(terminateEmployee).toHaveBeenCalledWith('emp-1', expect.objectContaining({ reason: 'Renuncia', expectedVersion: 'E1',
      terminatedOn: businessToday() }), expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('explains that a ramp agent with an operation in progress keeps the record and never shows the server title', async () => {
    const ramp = { ...summary, position: { id: 'pos-r', name: 'Agente de rampa', isRampPosition: true } };
    listEmployees.mockResolvedValue({ employees: [ramp], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    getEmployee.mockResolvedValue({ summary: ramp, identificationType: 'CEDULA', identificationNumber: '00100000011',
      identificationIsPlaceholder: false, phoneNumber: null, terminatedOn: null, terminationReason: null, futureShifts: 0,
      pendingAccessRequests: 0, assignments: [] });
    terminateEmployee.mockRejectedValueOnce(Object.assign(new Error('Governance record conflicts with current state.'),
      { status: 409, code: 'agent_has_operation_in_progress' }))
      .mockRejectedValueOnce(Object.assign(new Error('Invalid governance data.'), { status: 400 }));
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lucía Prueba' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const modal = screen.getByRole('alertdialog');
    expect(within(modal).getByText(/se liberan sus\s+coberturas de posición/)).toBeInTheDocument();
    // Only the agent unblocks it from the tablet: OCC has no action that closes an operation in progress.
    expect(within(modal).getByText(/la baja no se registra hasta que el\s+agente la envíe desde la tablet/))
      .toBeInTheDocument();
    expect(within(modal).queryByText(/OCC la cierre/)).not.toBeInTheDocument();
    await userEvent.type(within(modal).getByRole('textbox', { name: 'Motivo' }), 'Renuncia');
    await userEvent.click(within(modal).getByRole('button', { name: 'Dar de baja' }));
    const refusal = await within(modal).findByRole('alert');
    expect(refusal).toHaveTextContent(/tiene una operación en curso o devuelta/);
    expect(refusal).toHaveTextContent('Debe enviarla desde la tablet (si fue devuelta, corregirla y reenviarla)');
    expect(refusal).not.toHaveTextContent(/OCC/);
    await userEvent.click(within(modal).getByRole('button', { name: 'Dar de baja' }));
    expect(await within(modal).findByText('Revise los datos e intente de nuevo.')).toBeInTheDocument();
    expect(within(modal).queryByText(/Invalid governance data/)).not.toBeInTheDocument();
    // Each 4xx settled its intent: the second attempt is a new one.
    expect(terminateEmployee.mock.calls[1][2]).not.toBe(terminateEmployee.mock.calls[0][2]);
  });

  it('confirms a ramp termination without claiming what was released (2-N06)', async () => {
    const ramp = { ...summary, position: { id: 'pos-r', name: 'Agente de rampa', isRampPosition: true } };
    listEmployees.mockResolvedValue({ employees: [ramp], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    getEmployee.mockResolvedValue({ summary: ramp, identificationType: 'CEDULA', identificationNumber: '00100000011',
      identificationIsPlaceholder: false, phoneNumber: null, terminatedOn: null, terminationReason: null, futureShifts: 0,
      pendingAccessRequests: 0, assignments: [] });
    terminateEmployee.mockResolvedValue({ id: 'emp-1' });
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lucía Prueba' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const modal = screen.getByRole('alertdialog');
    await userEvent.type(within(modal).getByRole('textbox', { name: 'Motivo' }), 'Renuncia');
    await userEvent.click(within(modal).getByRole('button', { name: 'Dar de baja' }));
    // An agent without coverages, operations or shifts releases nothing, and OCC hears only of released operations.
    expect(await screen.findByText(/^Baja registrada\./)).toHaveTextContent('Baja registrada. La cuenta quedó ' +
      'desactivada y sin alcances. Si tenía coberturas, operaciones sin iniciar o turnos futuros, se liberaron; OCC ' +
      'recibe un aviso por cada operación liberada.');
    expect(screen.queryByText(/OCC recibió el aviso/)).not.toBeInTheDocument();
  });

  it('tells that a transfer out of the ramp waits for the agent to hand in an operation in progress', async () => {
    const ramp = { ...summary, department: 'operations',
      position: { id: 'pos-r', name: 'Agente de rampa', isRampPosition: true } };
    const commercial = { id: 'pos-c', department: 'contracts', name: 'Analista comercial', isRampPosition: false,
      isActive: true, suggestedAccessProfileId: null, suggestedAccessProfileName: null, employees: 0, version: 'P2' };
    listEmployees.mockResolvedValue({ employees: [ramp], total: 1 });
    getEmployeeOptions.mockResolvedValue({ ...options, positions: [analyst, commercial] });
    getEmployee.mockResolvedValue({ summary: ramp, identificationType: 'CEDULA', identificationNumber: '00100000011',
      identificationIsPlaceholder: false, phoneNumber: null, terminatedOn: null, terminationReason: null, futureShifts: 0,
      pendingAccessRequests: 0, assignments: [] });
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lucía Prueba' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Trasladar' }));
    const modal = screen.getByRole('dialog', { name: /Trasladar a/ });
    await userEvent.selectOptions(within(modal).getByRole('combobox', { name: 'Departamento de destino' }), 'contracts');
    await userEvent.selectOptions(within(modal).getByRole('combobox', { name: 'Puesto' }), 'pos-c');
    const notice = within(modal).getByText(/Al salir de rampa se liberan sus coberturas/);
    expect(notice).toHaveTextContent('OCC recibe un aviso por cada operación liberada');
    expect(notice).toHaveTextContent('el traslado no se registra hasta que el agente la envíe desde la tablet');
    expect(notice).not.toHaveTextContent(/OCC la cierre/);
    expect(transferEmployee).not.toHaveBeenCalled();
  });

  it('saves an edit with the record version and repeats its key after an uncertain answer (2-N06)', async () => {
    listEmployees.mockResolvedValue({ employees: [summary], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    getEmployee.mockResolvedValue({ summary, identificationType: 'CEDULA', identificationNumber: '001-0000001-7',
      identificationIsPlaceholder: false, phoneNumber: null, terminatedOn: null, terminationReason: null, futureShifts: 0,
      pendingAccessRequests: 0, assignments: [] });
    updateEmployee.mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409, code: 'version_conflict' }));
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lucía Prueba' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Editar expediente' }));
    const drawer = screen.getByRole('dialog', { name: 'Editar expediente' });
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await within(drawer).findByRole('alert'))
      .toHaveTextContent('No se pudo completar la acción. Revise la conexión e intente de nuevo.');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    // The retry is the same intent: same body and key, so a release the first attempt did is never repeated.
    expect(await within(drawer).findByText(/El expediente cambió mientras lo revisaba/)).toBeInTheDocument();
    expect(within(drawer).queryByText('Conflict')).not.toBeInTheDocument();
    const [first, second] = updateEmployee.mock.calls;
    expect(first[0]).toBe('emp-1');
    expect(first[1]).toEqual(expect.objectContaining({ employeeNumber: 'FIN-010', expectedVersion: 'E1' }));
    expect(first[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual(first);
  });

  it('hides HR writes from read-only accounts', async () => {
    listEmployees.mockResolvedValue({ employees: [summary], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    renderWith(<EmployeesPage />, ['human_resources.employees.read']);
    await screen.findByRole('button', { name: 'Lucía Prueba' });
    expect(screen.queryByRole('button', { name: 'Registrar empleado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Expedientes pendientes' })).not.toBeInTheDocument();
  });
});

describe('PositionsPage', () => {
  it('only offers the ramp flag for Operations and explains server rules', async () => {
    listPositions.mockResolvedValue([analyst]);
    savePosition.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409, code: 'position_name_in_use' }));
    renderWith(<PositionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo puesto' }));
    const modal = screen.getByRole('dialog');
    expect(within(modal).getByRole('checkbox', { name: /Puesto de rampa/ })).toBeInTheDocument();
    await userEvent.selectOptions(within(modal).getByRole('combobox', { name: 'Departamento' }), 'finance');
    expect(within(modal).queryByRole('checkbox', { name: /Puesto de rampa/ })).not.toBeInTheDocument();
    await userEvent.type(within(modal).getByRole('textbox', { name: 'Nombre' }), 'Analista de facturación');
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Ya existe un puesto con ese nombre');
  });
});

describe('RequisitionsPage', () => {
  it('attends a requisition and opens the hire form prefilled from it', async () => {
    const requisition = { id: 'req-1', department: 'finance', position: { id: 'pos-1', name: analyst.name, isRampPosition: false },
      quantity: 2, filled: 0, reason: 'Temporada alta', station, desiredStartOn: null, status: 'Open', requestedBy: 'Sofía',
      requestedAt: '2026-10-01T10:00:00Z', attendedBy: null, closedBy: null, closedAt: null, closureReason: null,
      employees: [], version: 'R1' };
    listRequisitions.mockResolvedValue([requisition]);
    changeRequisitionStatus.mockResolvedValue({ id: 'req-1' });
    getEmployeeOptions.mockResolvedValue(options);
    renderWith(<RequisitionsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atender' }));
    expect(changeRequisitionStatus).toHaveBeenCalledWith('req-1', { status: 'InProgress', reason: null, expectedVersion: 'R1' });
    await userEvent.click(screen.getByRole('button', { name: 'Registrar contratado' }));
    const drawer = await screen.findByRole('dialog', { name: 'Registrar empleado' });
    expect(within(drawer).getByRole('combobox', { name: 'Departamento' })).toHaveValue('finance');
    expect(within(drawer).getByRole('combobox', { name: 'Puesto' })).toHaveValue('pos-1');
  });

  it('renders the shared requisition card in English inside a language scope', () => {
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><RequisitionCard requisition={{ id: 'req-2', department: 'finance',
      position: { id: 'pos-1', name: analyst.name }, quantity: 2, filled: 1, reason: 'Temporada alta', station,
      desiredStartOn: '2026-11-01', status: 'InProgress', requestedBy: 'Sofía', requestedAt: '2026-10-01T10:00:00Z',
      attendedBy: 'Camila', closureReason: null, employees: [] }} /></LanguageScope>);
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText(/Finance · PUJ · from 2026-11-01/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 filled · requested by Sofía on 10\/1\/2026 · handled by Camila/)).toBeInTheDocument();
  });
});

describe('ActivityPanel', () => {
  it('preserves qualification, permit and availability labels in both languages', () => {
    expect(actionLabel('hr.qualification.recorded')).toBe('Registró una habilitación');
    expect(actionLabel('hr.permit.recorded', 'en')).toBe('Recorded an airport pass or permit');
    expect(actionLabel('hr.availability.approved', 'en')).toBe('Approved an availability request');
    expect(actionLabel('hr.availability.cancelled')).toBe('Canceló una solicitud de disponibilidad');
  });

  it('pages the trail with the cursor and labels actions', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce({ entries: [{ id: 'a1', occurredAt: '2026-10-09T10:00:00Z', actorName: 'Lucía Prueba',
        department: 'finance', action: 'auth.session.created', category: 'login', stationCode: null, reason: null }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ entries: [{ id: 'a2', occurredAt: '2026-10-09T09:00:00Z', actorName: 'Camila',
        department: 'finance', action: 'governance.access_request.validated', category: 'governance', stationCode: 'PUJ', reason: null }], nextCursor: null });
    render(<ActivityPanel load={load} />);
    expect(await screen.findByText(/Inició sesión/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText(/Validó un acceso/)).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('maps rule codes to explanations', () => {
    expect(governanceMessage({ status: 409, code: 'employee_terminated' })).toMatch(/dado de baja/);
    expect(governanceMessage({ status: 409 })).toMatch(/cambiaron/);
  });
});

describe('employee identification and phone rules', () => {
  it('explains a cédula with a wrong check digit and a phone without area code', async () => {
    const { identificationProblem, phoneProblem } = await import('./EmployeeForms');
    expect(identificationProblem('CEDULA', '001-0000001-1')).toMatch(/dígito verificador/);
    expect(identificationProblem('CEDULA', '001-0000001-7')).toBe('');
    expect(identificationProblem('PASAPORTE', '1111111')).toMatch(/pasaporte/i);
    expect(identificationProblem('PASAPORTE', 'RD12345A7')).toBe('El pasaporte dominicano: la posición 8 debe ser un dígito; encontramos «A». Formato: RD1234567.');
    expect(identificationProblem('CEDULA', '001-12345A7-8')).toBe('La posición 9 de la cédula debe ser un dígito; encontramos «A».');
    expect(phoneProblem('849-246-3371')).toBe('');
    expect(phoneProblem('555-0100')).toMatch(/10 dígitos/);
  });
});
