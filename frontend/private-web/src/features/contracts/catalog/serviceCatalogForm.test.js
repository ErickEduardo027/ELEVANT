import { describe, expect, it } from 'vitest';
import { OTHER_OPTION } from '../../../components/Combobox';
import { MAX_DISPLAY_ORDER, REFERENCE_SERVICES, billingUnitChoice, billingUnitOptions, buildServiceCatalog,
  buildServicePayload, nextDisplayOrder, publicationProblem, sortServicesByOrder, validateServiceForm } from './serviceCatalogForm';

const service = (id, code, name, extra = {}) => ({ id, code, name, displayOrder: 1, billingUnit: 'operación', ...extra });
const form = overrides => ({ serviceChoice: 'RAMP-CARGO', name: 'Carga y descarga', code: 'RAMP-CARGO',
  unitChoice: 'operación', description: 'Carga y descarga de aeronaves', imageUrl: '/assets/services/cargo-loading.webp', videoUrl: '',
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

it('offers the active units Finance maintains and keeps a legacy unit only for its own service', () => {
  const units = [{ code: 'operation', name: 'Operación', isActive: true }, { code: 'hour', name: 'Hora', isActive: true },
    { code: 'old', name: 'Antigua', isActive: false }];
  expect(billingUnitOptions(units).map(option => option.label)).toEqual(['Por hora', 'Por operación']);
  // 1-E: the options carry the unit code; a legacy name of an active unit is that unit, not a second option.
  expect(billingUnitOptions(units).map(option => option.value)).toEqual(['hour', 'operation']);
  expect(billingUnitOptions(units, 'operación')).toHaveLength(2);
  expect(billingUnitOptions(units, 'turno').at(-1)).toMatchObject({ value: 'turno', hint: expect.stringMatching(/heredada/) });
  expect(billingUnitOptions(units, 'old').at(-1)).toMatchObject({ value: 'old', label: 'Por antigua' });
  expect(billingUnitOptions(null)).toEqual([]);
  expect([billingUnitChoice('Operación', units), billingUnitChoice('hour', units), billingUnitChoice(' turno ', units)])
    .toEqual(['operation', 'hour', 'turno']);
});

it('explains what a service needs before it can be public', () => {
  expect(publicationProblem(form())).toBe('');
  expect(publicationProblem(form({ imageUrl: '' }))).toMatch(/foto real/);
  expect(publicationProblem(form({ imageUrl: '' }), { hasNewImage: true })).toBe('');
  expect(publicationProblem(form({ description: 'Corta' }))).toMatch(/20 caracteres/);
  expect(publicationProblem(form({ name: 'Servicio de prueba' }))).toMatch(/prueba/);
  expect(publicationProblem(form({ name: 'prueba', isPublic: false }))).toBe('');
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


  it('reports an exhausted order range', () => {
    expect(validateServiceForm(form({ displayOrder: null }), { catalog }).displayOrder).toMatch(/orden/);
  });
});

it('builds the API payload with normalized values and never «Otro»', () => {
  expect(buildServicePayload(form({ serviceChoice: OTHER_OPTION, name: '  Asistencia   especial ', code: ' sa ',
    unitChoice: ' hora ', description: ' Interior ' }))).toEqual({
    code: 'SA', name: 'Asistencia especial', description: 'Interior', billingUnit: 'hora',
    imageUrl: '/assets/services/cargo-loading.webp', videoUrl: '', displayOrder: 3, isPublic: true, isActive: true, version: null,
  });
});
