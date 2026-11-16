import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import PermitRecordForm from './PermitRecordForm';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { listPermitTypes } from '../../../services/humanResourcesSettingsService';

vi.mock('../../../services/commercialGovernanceApi', () => ({ getRampProfiles: vi.fn() }));
vi.mock('../../../services/humanResourcesPermitsReadService', () => ({
  getHumanResourcesPermits: vi.fn(), recordHumanResourcesPermit: vi.fn(),
}));
vi.mock('../../../services/humanResourcesSettingsService', async importOriginal => ({
  ...(await importOriginal()), listPermitTypes: vi.fn(),
}));

afterEach(() => { cleanup(); vi.resetAllMocks(); });

const profiles = () => getRampProfiles.mockResolvedValue({ profiles: [] });

// ADR-0045: the form offers the system types and the active custom ones of «Configuración».
it('offers the active custom permit types of the catalog', async () => {
  profiles();
  listPermitTypes.mockResolvedValue({ canCreate: true, canUpdate: true, permitTypes: [
    { id: null, code: 'AirportId', name: 'Carnet aeroportuario', isActive: true, isSystem: true, inUse: true, version: null },
    { id: null, code: 'RampDriverLicense', name: 'Licencia de conducir en rampa', isActive: true, isSystem: true, inUse: true, version: null },
    { id: 'p1', code: 'ZONA-RESTRINGIDA', name: 'Carnet de zona restringida', isActive: true, isSystem: false, inUse: false, version: 'v' },
    { id: 'p2', code: 'VIEJO', name: 'Carnet retirado', isActive: false, isSystem: false, inUse: true, version: 'v' },
  ] });
  render(<PermitRecordForm onRecorded={vi.fn()} onClose={vi.fn()} onDenied={vi.fn()} />);
  const select = await screen.findByLabelText('Tipo de documento');
  expect(await within(select).findByRole('option', { name: 'Carnet de zona restringida' })).toBeInTheDocument();
  expect(within(select).queryByRole('option', { name: 'Carnet retirado' })).not.toBeInTheDocument();
});

it('keeps the system types when the catalog cannot be read', async () => {
  profiles();
  listPermitTypes.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
  render(<PermitRecordForm onRecorded={vi.fn()} onClose={vi.fn()} onDenied={vi.fn()} />);
  const select = await screen.findByLabelText('Tipo de documento');
  expect(within(select).getAllByRole('option').map(option => option.textContent))
    .toEqual(['Selecciona un tipo', 'Carnet aeroportuario', 'Licencia de conducir en rampa']);
});
