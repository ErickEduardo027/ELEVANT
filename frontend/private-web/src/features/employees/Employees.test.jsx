import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { installFormValidation } from '../../components/formValidation';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider, administratorAccess } from '../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../access/testAccess';
import EmployeesPage from './EmployeesPage';
import PositionsPage from './PositionsPage';
import ActivityPanel, { actionLabel } from './ActivityPanel';
import { EmployeeDrawer, RegisterDrawer } from './EmployeeForms';
import { joinDominicanPassport, dominicanPassportDigits } from './identityDocumentValue';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import {
  createEmployee, getEmployee, registerEmployee, getEmployeeOptions, governanceMessage, listEmployees,
  listPositions, savePosition, terminateEmployee, transferEmployee, updateEmployee,
} from '../../services/humanResourcesEmployeesService';
import { addDays, businessToday } from '../../services/businessDay';

vi.mock('../../services/humanResourcesEmployeesService', async importOriginal => ({
  ...(await importOriginal()),
  listEmployees: vi.fn(), getEmployee: vi.fn(), getEmployeeOptions: vi.fn(), createEmployee: vi.fn(),
  terminateEmployee: vi.fn(), listUnregisteredPersons: vi.fn().mockResolvedValue([]), listPositions: vi.fn(),
  savePosition: vi.fn(), updateEmployee: vi.fn(),
  transferEmployee: vi.fn(), registerEmployee: vi.fn(),
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
  it('registers an employee without offering a requisition (ADR-0047)', async () => {
    listEmployees.mockResolvedValue({ employees: [], total: 0 });
    getEmployeeOptions.mockResolvedValue(options);
    createEmployee.mockResolvedValue({ id: 'emp-2' });
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar empleado' }));
    const drawer = screen.getByRole('dialog', { name: 'Registrar empleado' });
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Nombre' }), 'Valeria');
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Apellido' }), 'Nueva');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Documento' }), 'CEDULA');
    await userEvent.type(within(drawer).getByRole('textbox', { name: 'Número de documento' }), '001-0000001-7');
    await userEvent.type(within(drawer).getByRole('textbox', { name: /Número de empleado/ }), 'fin-020');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Departamento' }), 'finance');
    await userEvent.selectOptions(within(drawer).getByRole('combobox', { name: 'Puesto' }), 'pos-1');
    // Requisitions left the version 1 interface: the form never offers the open ones the server still lists.
    expect(within(drawer).queryByRole('combobox', { name: /requisición/ })).not.toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('checkbox', { name: 'PUJ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(createEmployee).toHaveBeenCalledWith(expect.objectContaining({ employeeNumber: 'FIN-020', department: 'finance',
      positionId: 'pos-1', requisitionId: null, stationIds: ['st-1'], corporateEmail: null }));
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
    expect(screen.queryByRole('tab', { name: 'Puestos' })).not.toBeInTheDocument();
  });

  it('shows Puestos as a tab of Empleados (ADR-0047)', async () => {
    listEmployees.mockResolvedValue({ employees: [summary], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    listPositions.mockResolvedValue([analyst]);
    renderWith(<EmployeesPage />);
    const tabs = await screen.findByRole('tablist');
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Empleados', 'Puestos', 'Expedientes pendientes']);
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Puestos' }));
    expect(await screen.findByText(analyst.name, { selector: 'td, td *' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo puesto' })).toBeInTheDocument();
    // One page heading: the tab does not repeat its own.
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Empleados']);
  });

  it('offers the Puestos tab to a positions reader without HR writes', async () => {
    listEmployees.mockResolvedValue({ employees: [summary], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    listPositions.mockResolvedValue([analyst]);
    renderWith(<EmployeesPage />, ['human_resources.employees.read', 'human_resources.positions.read']);
    const tabs = await screen.findByRole('tablist');
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Empleados', 'Puestos']);
    await userEvent.click(within(tabs).getByRole('tab', { name: 'Puestos' }));
    await screen.findByText(analyst.name, { selector: 'td, td *' });
    expect(screen.queryByRole('button', { name: 'Nuevo puesto' })).not.toBeInTheDocument();
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

describe('masks and inline rules of the employee forms', () => {
  let uninstall;
  beforeEach(() => { uninstall = installFormValidation(document); });
  afterEach(() => uninstall());
  const documentInput = () => screen.getByRole('textbox', { name: 'Número de documento' });
  const messageOf = field => document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent;
  const fillEmployee = async () => {
    await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Valeria');
    await userEvent.type(screen.getByRole('textbox', { name: 'Apellido' }), 'Nueva');
    await userEvent.type(screen.getByRole('textbox', { name: /Número de empleado/ }), 'fin-020');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Departamento' }), 'finance');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Puesto' }), 'pos-1');
  };

  it('masks a cédula as ###-#######-# and sends its 11 digits', async () => {
    createEmployee.mockResolvedValue({ id: 'emp-2' });
    render(<EmployeeDrawer open options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Documento' }), 'CEDULA');
    await userEvent.type(documentInput(), '00100000017999');
    expect(documentInput()).toHaveValue('001-0000001-7');
    expect(documentInput()).toHaveAttribute('inputmode', 'numeric');
    expect(documentInput()).toHaveAttribute('autocomplete', 'off');
    expect(documentInput()).toHaveAttribute('maxlength', '13');
    await fillEmployee();
    await userEvent.click(screen.getByRole('checkbox', { name: 'PUJ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(createEmployee).toHaveBeenCalledWith(expect.objectContaining({ identificationType: 'CEDULA',
      identificationNumber: '00100000017' }));
  }, 15_000);

  it('masks a residence card and shows a stored cédula with its dashes', async () => {
    const detail = { summary, identificationType: 'RESIDENCIA', identificationNumber: '00100000017',
      identificationIsPlaceholder: false, phoneNumber: '+18095550100' };
    render(<EmployeeDrawer open employee={detail} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(documentInput()).toHaveValue('001-0000001-7');
    // A stored E.164 phone opens as it is: the international shape keeps its +.
    expect(screen.getByRole('textbox', { name: 'Teléfono' })).toHaveValue('+18095550100');
  });

  it('formats a Dominican phone while typing and explains one that is not valid under the field', async () => {
    render(<EmployeeDrawer open options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    const phone = screen.getByRole('textbox', { name: 'Teléfono' });
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('inputmode', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    await userEvent.type(phone, '8095550100');
    expect(phone).toHaveValue('809-555-0100');
    expect(phone.validity.valid).toBe(true);
    await userEvent.clear(phone);
    await userEvent.type(phone, '5550100');
    expect(phone).toHaveValue('555-010-0');
    await fillEmployee();
    await userEvent.click(screen.getByRole('checkbox', { name: 'PUJ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(createEmployee).not.toHaveBeenCalled();
    expect(messageOf(phone)).toMatch(/10 dígitos \(809, 829 o 849\)/);
  }, 15_000);

  it('asks for at least one station next to the group and blocks the save', async () => {
    render(<EmployeeDrawer open options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(documentInput(), '1234567');
    await fillEmployee();
    expect(screen.queryByText('Marca al menos una estación.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(createEmployee).not.toHaveBeenCalled();
    const message = screen.getByText('Marca al menos una estación.');
    expect(message).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('group', { name: 'Estaciones donde trabaja' })).toHaveAttribute('aria-describedby', message.id);
    await userEvent.click(screen.getByRole('checkbox', { name: 'PUJ' }));
    expect(screen.queryByText('Marca al menos una estación.')).not.toBeInTheDocument();
  }, 15_000);

  it('says at once that more than 20 stations is too many', async () => {
    const many = Array.from({ length: 21 }, (_, index) => ({ id: `st-${index}`, code: `S${String(index).padStart(2, '0')}` }));
    render(<EmployeeDrawer open options={{ ...options, stations: many }} onClose={vi.fn()} onSaved={vi.fn()} />);
    for (const item of many) await userEvent.click(screen.getByRole('checkbox', { name: item.code }));
    expect(screen.getByRole('alert')).toHaveTextContent('Máximo 20 estaciones.');
  }, 20_000);

  it('bounds the hire date like the server: from 1950 to 30 days after today', async () => {
    render(<EmployeeDrawer open options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    const hireDate = screen.getByLabelText('Fecha de ingreso');
    expect(hireDate).toHaveAttribute('min', '1950-01-01');
    expect(hireDate).toHaveAttribute('max', addDays(businessToday(), 30));
    fireEvent.change(hireDate, { target: { value: '1949-12-31' } });
    expect(hireDate.validationMessage).toMatch(/^La fecha de ingreso va del 01\/01\/1950 al \d{2}\/\d{2}\/\d{4} \(hasta 30 días después de hoy\)\.$/);
    fireEvent.change(hireDate, { target: { value: businessToday() } });
    expect(hireDate.validity.valid).toBe(true);
  });

  it('gives «Registrar expediente» the employee number rule, the phone mask and the station check', async () => {
    const person = { accountId: 'acc-9', firstName: 'Ana', lastName: 'Sin', department: 'finance', employeeNumber: null, stations: [] };
    render(<RegisterDrawer person={person} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    const number = screen.getByRole('textbox', { name: 'Número de empleado' });
    expect(number).toHaveAttribute('pattern', '[A-Za-z0-9\\-]{2,32}');
    await userEvent.type(number, 'x');
    expect(number).toHaveValue('X');
    const phone = screen.getByRole('textbox', { name: 'Teléfono' });
    expect(phone).toHaveAttribute('type', 'tel');
    await userEvent.type(phone, '8295550100');
    expect(phone).toHaveValue('829-555-0100');
    await userEvent.type(documentInput(), '1234567');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Puesto' }), 'pos-1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(registerEmployee).not.toHaveBeenCalled();
    expect(messageOf(number)).toBe('Usa de 2 a 32 letras, dígitos o guiones, p. ej. QA-FIN-010.');
    await userEvent.type(number, '-1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(registerEmployee).not.toHaveBeenCalled();
    expect(screen.getByText('Marca al menos una estación.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'PUJ' }));
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(registerEmployee).toHaveBeenCalledWith(expect.objectContaining({ employeeNumber: 'X-1', phoneNumber: '829-555-0100',
      stationIds: ['st-1'] }));
  }, 20_000);

  it('counts a transfer or termination reason without its outer spaces (3 to 500, like the server)', async () => {
    listEmployees.mockResolvedValue({ employees: [summary], total: 1 });
    getEmployeeOptions.mockResolvedValue(options);
    getEmployee.mockResolvedValue({ summary, identificationType: 'CEDULA', identificationNumber: '00100000011',
      identificationIsPlaceholder: false, phoneNumber: null, terminatedOn: null, terminationReason: null, futureShifts: 0,
      pendingAccessRequests: 0, assignments: [] });
    renderWith(<EmployeesPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lucía Prueba' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }));
    const modal = screen.getByRole('alertdialog');
    const reason = within(modal).getByRole('textbox', { name: 'Motivo' });
    await userEvent.type(reason, '   ok   ');
    await userEvent.click(within(modal).getByRole('button', { name: 'Dar de baja' }));
    expect(terminateEmployee).not.toHaveBeenCalled();
    expect(messageOf(reason)).toBe('Escribe al menos 3 caracteres sin contar los espacios de los extremos (ahora tiene 2).');
  });
});

describe('Dominican passport by default', () => {
  // These tests type a whole form key by key: a loaded full run needs more than the default 5 s.
  const documentInput = () => screen.getByRole('textbox', { name: 'Número de documento' });
  const fillEmployee = async () => {
    await userEvent.type(screen.getByRole('textbox', { name: 'Nombre' }), 'Valeria');
    await userEvent.type(screen.getByRole('textbox', { name: 'Apellido' }), 'Nueva');
    await userEvent.type(screen.getByRole('textbox', { name: /Número de empleado/ }), 'fin-020');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Departamento' }), 'finance');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Puesto' }), 'pos-1');
    // The server takes 1 to 20 stations: the form no longer sends a record without one.
    await userEvent.click(screen.getByRole('checkbox', { name: 'PUJ' }));
  };

  it('joins and splits the RD prefix without doubling a pasted one', () => {
    expect(joinDominicanPassport('1234567')).toBe('RD1234567');
    expect(joinDominicanPassport('rd 123-4567')).toBe('RD1234567');
    expect(joinDominicanPassport('')).toBe('');
    expect(dominicanPassportDigits('RD1234567')).toBe('1234567');
  });

  it('starts a new employee with a passport, shows a fixed RD and submits RD plus the digits', async () => {
    createEmployee.mockResolvedValue({ id: 'emp-2' });
    render(<EmployeeDrawer open options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Documento' })).toHaveValue('PASAPORTE');
    expect(screen.getByText('RD')).toBeInTheDocument();
    await userEvent.type(documentInput(), 'RD1234567');
    expect(documentInput()).toHaveValue('1234567');
    await fillEmployee();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(createEmployee).toHaveBeenCalledWith(expect.objectContaining({ identificationType: 'PASAPORTE', identificationNumber: 'RD1234567' }));
  }, 15_000);

  it('accepts a foreign passport without the prefix', async () => {
    createEmployee.mockResolvedValue({ id: 'emp-2' });
    render(<EmployeeDrawer open options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Pasaporte extranjero' }));
    expect(screen.queryByText('RD')).not.toBeInTheDocument();
    await userEvent.type(documentInput(), 'X1234567');
    await fillEmployee();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(createEmployee).toHaveBeenCalledWith(expect.objectContaining({ identificationType: 'PASAPORTE', identificationNumber: 'X1234567' }));
  }, 15_000);

  it('keeps cédula unchanged and never sends the RD the form wrote', async () => {
    render(<EmployeeDrawer open options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(documentInput(), '123');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Documento' }), 'CEDULA');
    expect(documentInput()).toHaveValue('123');
    expect(screen.queryByRole('checkbox', { name: 'Pasaporte extranjero' })).not.toBeInTheDocument();
  });

  it('splits a stored Dominican passport and opens a stored foreign one as foreign', async () => {
    const detail = { summary, identificationType: 'PASAPORTE', identificationNumber: 'RD7654321', identificationIsPlaceholder: false,
      phoneNumber: null };
    const { rerender } = render(<EmployeeDrawer open employee={detail} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(documentInput()).toHaveValue('7654321');
    expect(screen.getByRole('checkbox', { name: 'Pasaporte extranjero' })).not.toBeChecked();
    rerender(<EmployeeDrawer open employee={{ ...detail, identificationNumber: 'X7654321' }} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(documentInput()).toHaveValue('X7654321');
    expect(screen.getByRole('checkbox', { name: 'Pasaporte extranjero' })).toBeChecked();
  });

  it('registers a legacy account with a Dominican passport by default', async () => {
    registerEmployee.mockResolvedValue({ id: 'emp-3' });
    const person = { accountId: 'acc-9', firstName: 'Ana', lastName: 'Sin', department: 'finance', employeeNumber: 'FIN-099', stations: [station] };
    render(<RegisterDrawer person={person} options={options} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Documento' })).toHaveValue('PASAPORTE');
    await userEvent.type(documentInput(), '1234567');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Puesto' }), 'pos-1');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(registerEmployee).toHaveBeenCalledWith(expect.objectContaining({ identificationType: 'PASAPORTE', identificationNumber: 'RD1234567', accountId: 'acc-9' }));
  }, 15_000);
});
