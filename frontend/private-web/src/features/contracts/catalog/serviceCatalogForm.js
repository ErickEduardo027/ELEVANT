import { OTHER_OPTION } from '../../../components/Combobox';
import { billingUnitCode, billingUnitLabel } from '../../../services/billingUnits';

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

// Lo que exige el API para mostrar un servicio en el catálogo público
// (CommercialCatalogPublication.cs): foto real, descripción útil y nombre que no sea de prueba.
export const MIN_PUBLIC_DESCRIPTION = 20;
const PLACEHOLDER_NAME = /(^|[^\p{L}\d])(prueba|pruebas|test|testing|demo|ejemplo|dummy|asdf|xxx+)(?=$|[^\p{L}\d])/iu;

// Límites que aplica el API al guardar un servicio.
export const MAX_DISPLAY_ORDER = 10000;
const CODE_PATTERN = /^[A-Z0-9-]{1,40}$/;
const NAME_MAX = 160;
const DESCRIPTION_MAX = 500;

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

/** Spanish noun of a billing unit for «Por …», e.g. «operación» for the unit «Operación». */
export const unitValue = unit => normalizeText(unit.name).toLocaleLowerCase('es');

// Unidades activas que mantiene Finanzas en «Unidades de cobro», por su código: el catálogo guarda el
// código (1-E). Un servicio antiguo con una unidad escrita a mano que no nombra ninguna unidad la
// conserva como «heredada» hasta que se cambie.
export function billingUnitOptions(units, currentUnit = '') {
  const options = (units ?? []).filter(unit => unit.isActive)
    .map(unit => ({ value: unit.code, label: `Por ${unitValue(unit)}`, hint: unit.code }))
    .sort((left, right) => collator.compare(left.label, right.label));
  const current = normalizeText(currentUnit);
  if (current && !billingUnitCode(current, units))
    options.push({ value: current, label: `Por ${billingUnitLabel(current, units ?? [])}`,
      hint: 'Unidad heredada: elija una de la lista para cambiarla' });
  return options;
}

/** The value the unit field starts with: the code the stored unit names, else the legacy text itself. */
export const billingUnitChoice = (unit, units) => billingUnitCode(unit, units ?? []) ?? normalizeText(unit);

/** Text that explains why the service cannot be public yet, or ''. */
export function publicationProblem(form, { hasNewImage = false } = {}) {
  if (!form.isPublic || !form.isActive) return '';
  if (!form.imageUrl && !hasNewImage) return 'Para publicarlo agregue una foto real del servicio.';
  if (form.description.trim().length < MIN_PUBLIC_DESCRIPTION)
    return `Para publicarlo la descripción debe tener al menos ${MIN_PUBLIC_DESCRIPTION} caracteres.`;
  if (PLACEHOLDER_NAME.test(form.name) || PLACEHOLDER_NAME.test(form.code))
    return 'Un servicio con nombre o código de prueba no puede publicarse. Use el nombre comercial real.';
  return '';
}

function resolveBillingUnit(form) {
  return normalizeText(form.unitChoice);
}

export function validateServiceForm(form, { catalog = [], editingId = null, hasNewImage = false } = {}) {
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

  if (!resolveBillingUnit(form)) errors.unitChoice = 'Selecciona cómo se cobra el servicio.';

  const description = form.description.trim();
  if (!description) errors.description = 'Escribe una descripción breve del servicio.';
  else if (description.length > DESCRIPTION_MAX) errors.description = `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`;

  const publication = publicationProblem(form, { hasNewImage });
  if (publication) errors.isPublic = publication;

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
