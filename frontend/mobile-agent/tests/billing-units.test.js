// S5 (D-S5): the tablet names a billing unit in Spanish, as Finance does, with an explicit plural («1 operación»,
// «0 operaciones»), reads a legacy name («operación», «Hora») like its code, and takes whole numbers only in the
// units that count things. The Service Order keeps the abbreviations its PDF prints («1 h», «1 serv.»).
const {
  billingUnitAbbreviation,
  billingUnitDecimals,
  billingUnitName,
} = require('../src/utils/billing-units');

const SEEDED_CODES = ['operation', 'aircraft', 'passenger', 'ton', 'hour', 'minute', 'unit', 'service', 'day'];

test('a unit is singular only for exactly one: 0, 1,5 and 3 are plural', () => {
  expect([0, 1, 1.5, 3].map(quantity => billingUnitName('hour', quantity)))
    .toEqual(['horas', 'hora', 'horas', 'horas']);
  expect([0, 1, 1.5, 3].map(quantity => billingUnitName('operation', quantity)))
    .toEqual(['operaciones', 'operación', 'operaciones', 'operaciones']);
  // Without a quantity it names the unit in general, as in «Cantidad ejecutada (horas)».
  expect(billingUnitName('hour')).toBe('horas');
});

test('every unit Finance seeds has its Spanish noun, with an explicit plural', () => {
  expect(SEEDED_CODES.map(code => billingUnitName(code, 1))).toEqual([
    'operación', 'aeronave', 'pasajero', 'tonelada', 'hora', 'minuto', 'unidad', 'servicio', 'día',
  ]);
  expect(SEEDED_CODES.map(code => billingUnitName(code, 2))).toEqual([
    'operaciones', 'aeronaves', 'pasajeros', 'toneladas', 'horas', 'minutos', 'unidades', 'servicios', 'días',
  ]);
});

test('a code in any casing or a legacy name, with or without accents, names the same unit', () => {
  expect(['operation', 'OPERATION', 'operación', 'Operacion', ' Operación '].map(unit => billingUnitName(unit, 1)))
    .toEqual(['operación', 'operación', 'operación', 'operación', 'operación']);
  expect(['Hora', 'hora', 'HOUR'].map(unit => billingUnitName(unit, 2))).toEqual(['horas', 'horas', 'horas']);
  expect(['Día', 'dia'].map(unit => billingUnitName(unit, 3))).toEqual(['días', 'días']);
  expect(billingUnitDecimals('Operación')).toBe(0);
  expect(billingUnitDecimals('Hora')).toBe(4);
});

test('an unknown unit is shown as it is; a name inherited from Object.prototype is not a unit', () => {
  expect(billingUnitName('UN', 2)).toBe('UN');
  expect(billingUnitName(' galón ', 1)).toBe('galón');
  expect(billingUnitName('', 1)).toBe('');
  expect(billingUnitName(null, 1)).toBe('');
  for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    expect(billingUnitName(name, 1)).toBe(name);
    expect(billingUnitName(name)).toBe(name);
    expect(billingUnitDecimals(name)).toBe(4);
    expect(billingUnitAbbreviation(name)).toBe(name);
  }
});

test('count units take whole numbers; the others, and the unknown ones, up to four decimals', () => {
  expect(['operation', 'service', 'aircraft', 'passenger', 'Servicio', 'PASAJERO'].map(billingUnitDecimals))
    .toEqual([0, 0, 0, 0, 0, 0]);
  // «Unidad» admits two decimals in Finance, and time and weight are measured: the tablet never rejects what Finance
  // admits.
  expect(['hour', 'minute', 'day', 'ton', 'unit', 'UN', '', null, undefined].map(billingUnitDecimals))
    .toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4]);
});

test('the Service Order keeps the abbreviations its PDF prints: «1 h» and «1 serv.»', () => {
  expect(['hour', 'PerHour', 'hours'].map(billingUnitAbbreviation)).toEqual(['h', 'h', 'h']);
  expect(['operation', 'service', 'PerOperation', 'turnaround'].map(billingUnitAbbreviation))
    .toEqual(['serv.', 'serv.', 'serv.', 'serv.']);
  expect(['unit', 'each'].map(billingUnitAbbreviation)).toEqual(['unid.', 'unid.']);
  expect(billingUnitAbbreviation('ton')).toBe('ton');
});
