import { describe, expect, it } from 'vitest';
import { OTHER_OPTION } from '../../../components/Combobox';
import { BILLING_UNITS, MAX_DISPLAY_ORDER, REFERENCE_SERVICES, billingUnitOptions, buildServiceCatalog,
  buildServicePayload, nextDisplayOrder, sortServicesByOrder, validateServiceForm } from './serviceCatalogForm';

const service = (id, code, name, extra = {}) => ({ id, code, name, displayOrder: 1, billingUnit: 'operación', ...extra });
const form = overrides => ({ serviceChoice: 'RAMP-CARGO', name: 'Carga y descarga', code: 'RAMP-CARGO',
  unitChoice: 'operación', customUnit: '', description: 'Carga', imageUrl: '', videoUrl: '',
  displayOrder: 3, isPublic: true, isActive: true, version: null, ...overrides });

describe('nextDisplayOrder', () => {
  it('starts at one and continues after the highest order', () => {
    expect(nextDisplayOrder([])).toBe(1);
    expect(nextDisplayOrder([{ displayOrder: 0 }, { displayOrder: 7 }, { displayOrder: 2 }])).toBe(8);
  });

  it('returns null once the API range is exhausted', () => {
    expect(nextDisplayOrder([{ displayOrder: MAX_DISPLAY_ORDER - 1 }])).toBe(MAX_DISPLAY_ORDER);
    expect(nextDisplayOrder([{ displayOrder: MAX_DISPLAY_ORDER }])).toBeNull();
  });
});

it('orders services like the API: display order first, then name', () => {
  const sorted = sortServicesByOrder([
    { name: 'Zeta', displayOrder: 2 }, { name: 'Beta', displayOrder: 0 },
    { name: 'Alfa', displayOrder: 2 }, { name: 'Gamma', displayOrder: 1 },
  ]);
  expect(sorted.map(item => item.name)).toEqual(['Beta', 'Gamma', 'Alfa', 'Zeta']);
});

describe('buildServiceCatalog', () => {
  it('merges created services with the ramp references into one entity per code', () => {
    const created = service('a', 'SA', 'Asistencia especial');
    const renamed = service('b', 'RAMP-TOW', 'Remolque');
    const catalog = buildServiceCatalog([created, renamed]);

    expect(catalog).toHaveLength(REFERENCE_SERVICES.length + 1);
    expect(catalog.find(entry => entry.code === 'SA')).toEqual({ code: 'SA', name: 'Asistencia especial', service: created });
    expect(catalog.find(entry => entry.code === 'RAMP-TOW')).toMatchObject({ name: 'Remolque', service: renamed });
    expect(catalog.find(entry => entry.code === 'RAMP-AC')).toMatchObject({ service: null });
    expect(catalog.map(entry => entry.name)).toEqual([...catalog.map(entry => entry.name)].sort((a, b) => a.localeCompare(b, 'es')));
  });
});

it('offers the base billing units plus units already used in the catalog', () => {
  const options = billingUnitOptions([service('a', 'A', 'A', { billingUnit: 'operation' }),
    service('b', 'B', 'B', { billingUnit: 'Operación' })]);
  expect(options.slice(0, BILLING_UNITS.length)).toEqual(BILLING_UNITS);
  expect(options.slice(BILLING_UNITS.length).map(option => option.value)).toEqual(['operation']);
});

describe('validateServiceForm', () => {
  const catalog = buildServiceCatalog([service('existing', 'RAMP-TOW', 'Remolque de aeronaves')]);

  it('accepts a reference service that is not in the catalog yet', () => {
    expect(validateServiceForm(form(), { catalog })).toEqual({});
  });

  it('asks for a service and billing unit', () => {
    expect(validateServiceForm(form({ serviceChoice: '', unitChoice: '' }), { catalog })).toMatchObject({
      serviceChoice: 'Selecciona un servicio.', unitChoice: 'Selecciona cómo se cobra el servicio.',
    });
  });

  it('rejects creating a service that already exists', () => {
    expect(validateServiceForm(form({ serviceChoice: 'RAMP-TOW', name: 'Remolque de aeronaves', code: 'RAMP-TOW' }), { catalog }).serviceChoice)
      .toBe('Ya existe un servicio con ese nombre y código.');
  });

  it('validates a new service name and code against the whole catalog', () => {
    const newService = overrides => validateServiceForm(form({ serviceChoice: OTHER_OPTION, ...overrides }), { catalog });
    expect(newService({ name: '  ', code: '' })).toMatchObject({
      customName: 'Escribe el nombre del servicio personalizado.', customCode: 'Escribe el código del nuevo servicio.',
    });
    expect(newService({ name: 'Asistencia', code: 'S A' }).customCode).toMatch(/sin espacios/);
    expect(newService({ name: 'remolque  de AERONAVES', code: 'SA' }).customName).toBe('Ya existe un servicio llamado «Remolque de aeronaves».');
    expect(newService({ name: 'Aire acondicionado', code: 'SA' }).customName).toMatch(/corresponde al servicio RAMP-AC/);
    expect(newService({ name: 'Asistencia', code: 'ramp-ac' }).customCode).toBe('El código RAMP-AC ya pertenece a «Aire acondicionado».');
    expect(newService({ name: 'Asistencia especial', code: 'sa' })).toEqual({});
  });

  it('lets an edited service keep its own name but not take another one', () => {
    const edited = form({ serviceChoice: 'RAMP-TOW', name: 'Remolque de aeronaves', code: 'RAMP-TOW' });
    expect(validateServiceForm(edited, { catalog, editingId: 'existing' })).toEqual({});
    expect(validateServiceForm({ ...edited, name: '' }, { catalog, editingId: 'existing' }).name).toBe('Escribe el nombre del servicio.');
  });

  it('requires the custom billing unit when «Otro» is selected', () => {
    expect(validateServiceForm(form({ unitChoice: OTHER_OPTION, customUnit: ' ' }), { catalog }).customUnit)
      .toBe('Escribe la unidad de cobro personalizada.');
  });

  it('reports an exhausted order range', () => {
    expect(validateServiceForm(form({ displayOrder: null }), { catalog }).displayOrder).toMatch(/orden/);
  });
});

it('builds the API payload with normalized values and never «Otro»', () => {
  expect(buildServicePayload(form({ serviceChoice: OTHER_OPTION, name: '  Asistencia   especial ', code: ' sa ',
    unitChoice: OTHER_OPTION, customUnit: ' turno ', description: ' Interior ' }))).toEqual({
    code: 'SA', name: 'Asistencia especial', description: 'Interior', billingUnit: 'turno',
    imageUrl: '', videoUrl: '', displayOrder: 3, isPublic: true, isActive: true, version: null,
  });
});
