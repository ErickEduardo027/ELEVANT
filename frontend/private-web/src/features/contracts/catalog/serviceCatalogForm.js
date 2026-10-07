import { OTHER_OPTION } from '../../../components/Combobox';

// Servicios de rampa con código formal en ELEVANT aunque todavía no estén en el
// catálogo. Fuente: los códigos que reconoce `CommercialServiceMediaDefaults.cs`
// y los nombres del catálogo comercial sembrado.
export const REFERENCE_SERVICES = [
  { code: 'RAMP-CARGO', name: 'Carga y descarga' },
  { code: 'RAMP-TOW', name: 'Remolque de aeronaves' },
  { code: 'RAMP-AC', name: 'Aire acondicionado' },
  { code: 'RAMP-GPU', name: 'Unidad generadora de energía' },
  { code: 'RAMP-ASU', name: 'Unidad generadora a reacción' },
  { code: 'RAMP-PARKING', name: 'Asistencia de parqueo de aeronaves' },
  { code: 'RAMP-STAIRS', name: 'Escaleras móviles' },
];

// Catálogo inicial de unidades habituales en tarifas de ground handling. El valor
// se guarda como sustantivo porque las tarifas lo muestran como «Precio por …».
export const BILLING_UNITS = [
  { value: 'operación', label: 'Por operación', hint: 'Turnaround o vuelo atendido' },
  { value: 'aeronave', label: 'Por aeronave', hint: 'Cada aeronave atendida' },
  { value: 'pasajero', label: 'Por pasajero', hint: 'Volumen de pasajeros' },
  { value: 'tonelada', label: 'Por tonelada', hint: 'Peso de carga' },
  { value: 'hora', label: 'Por hora', hint: 'Uso de equipo o personal' },
  { value: 'unidad', label: 'Por unidad', hint: 'Elementos contados uno a uno' },
  { value: 'servicio', label: 'Por servicio', hint: 'Prestación individual' },
  { value: 'día', label: 'Por día', hint: 'Duración diaria' },
];

// Límites que aplica el API al guardar un servicio.
export const MAX_DISPLAY_ORDER = 10000;
const CODE_PATTERN = /^[A-Z0-9-]{1,40}$/;
const NAME_MAX = 160;
const DESCRIPTION_MAX = 500;
const BILLING_UNIT_MAX = 32;

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const sameText = (left, right) => collator.compare(left, right) === 0;

export const normalizeText = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalizeCode = value => String(value ?? '').trim().toUpperCase();

// Mismo orden que aplica el API: número de orden y, en empate, nombre.
export function sortServicesByOrder(services) {
  return [...services].sort((left, right) =>
    left.displayOrder - right.displayOrder || collator.compare(left.name, right.name));
}

// El API no asigna el orden: el servicio nuevo va detrás del mayor número
// existente, contando ocultos y retirados. `null` indica que se agotó el rango.
export function nextDisplayOrder(services) {
  const highest = services.reduce((max, service) => Math.max(max, service.displayOrder ?? 0), 0);
  const next = highest + 1;
  return next > MAX_DISPLAY_ORDER ? null : next;
}

// Un único catálogo de servicios (código + nombre): los del API y las
// referencias de rampa que aún no se han creado.
export function buildServiceCatalog(services) {
  const byCode = new Map(REFERENCE_SERVICES.map(entry => [entry.code, { ...entry, service: null }]));
  services.forEach(service => byCode.set(normalizeCode(service.code),
    { code: normalizeCode(service.code), name: service.name, service }));
  return [...byCode.values()].sort((left, right) => collator.compare(left.name, right.name));
}

// Unidades del catálogo inicial más las que ya usan servicios existentes.
export function billingUnitOptions(services) {
  const extra = [...new Set(services.map(service => normalizeText(service.billingUnit)))]
    .filter(unit => unit && !BILLING_UNITS.some(option => sameText(option.value, unit)))
    .sort(collator.compare)
    .map(unit => ({ value: unit, label: unit, hint: 'En uso en el catálogo' }));
  return [...BILLING_UNITS, ...extra];
}

function resolveBillingUnit(form) {
  return normalizeText(form.unitChoice === OTHER_OPTION ? form.customUnit : form.unitChoice);
}

export function validateServiceForm(form, { catalog = [], editingId = null } = {}) {
  const errors = {};
  const name = normalizeText(form.name);
  const code = normalizeCode(form.code);
  const isNew = !editingId && form.serviceChoice === OTHER_OPTION;
  const others = catalog.filter(entry => !editingId || entry.service?.id !== editingId);

  if (!editingId && !form.serviceChoice) errors.serviceChoice = 'Selecciona un servicio.';
  else if (!editingId && !isNew) {
    if (catalog.find(entry => entry.code === code)?.service) errors.serviceChoice = 'Ya existe un servicio con ese nombre y código.';
  } else {
    const nameField = isNew ? 'customName' : 'name';
    const sameName = others.find(entry => sameText(entry.name, name));
    if (!name) errors[nameField] = isNew ? 'Escribe el nombre del servicio personalizado.' : 'Escribe el nombre del servicio.';
    else if (name.length > NAME_MAX) errors[nameField] = `El nombre no puede superar ${NAME_MAX} caracteres.`;
    else if (sameName) {
      errors[nameField] = sameName.service ? `Ya existe un servicio llamado «${sameName.service.name}».`
        : `«${sameName.name}» corresponde al servicio ${sameName.code} de la lista${isNew ? '; selecciónalo allí' : ''}.`;
    }
    if (isNew) {
      const sameCode = catalog.find(entry => entry.code === code);
      if (!code) errors.customCode = 'Escribe el código del nuevo servicio.';
      else if (!CODE_PATTERN.test(code)) errors.customCode = 'Usa solo letras de la A a la Z, números y guiones, sin espacios (máximo 40).';
      else if (sameCode) errors.customCode = `El código ${code} ya pertenece a «${sameCode.name}».`;
    }
  }

  const billingUnit = resolveBillingUnit(form);
  if (!form.unitChoice) errors.unitChoice = 'Selecciona cómo se cobra el servicio.';
  else if (form.unitChoice === OTHER_OPTION && !billingUnit) errors.customUnit = 'Escribe la unidad de cobro personalizada.';
  else if (billingUnit.length > BILLING_UNIT_MAX) {
    errors[form.unitChoice === OTHER_OPTION ? 'customUnit' : 'unitChoice'] = `La unidad de cobro no puede superar ${BILLING_UNIT_MAX} caracteres.`;
  }

  const description = form.description.trim();
  if (!description) errors.description = 'Escribe una descripción breve del servicio.';
  else if (description.length > DESCRIPTION_MAX) errors.description = `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`;

  if (form.displayOrder === null) {
    errors.displayOrder = `No hay números de orden disponibles (máximo ${MAX_DISPLAY_ORDER}). Contacta a soporte.`;
  }
  return errors;
}

// Construye el cuerpo que espera el API; las opciones «Otro» nunca se envían literalmente.
export function buildServicePayload(form) {
  return {
    code: normalizeCode(form.code),
    name: normalizeText(form.name),
    description: form.description.trim(),
    billingUnit: resolveBillingUnit(form),
    imageUrl: form.imageUrl,
    videoUrl: form.videoUrl,
    displayOrder: form.displayOrder,
    isPublic: form.isPublic,
    isActive: form.isActive,
    version: form.version,
  };
}
