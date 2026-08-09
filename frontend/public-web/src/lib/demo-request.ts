export const DEMO_REQUEST_FIELDS = [
  "nombre",
  "aerolinea",
  "cargo",
  "correoCorporativo",
  "estacionPais",
  "necesidadOperativa",
] as const;

export type DemoRequestField = (typeof DEMO_REQUEST_FIELDS)[number];

export interface DemoRequestDraft {
  nombre: string;
  aerolinea: string;
  cargo: string;
  correoCorporativo: string;
  estacionPais: string;
  necesidadOperativa: string;
}

export type DemoRequestErrors = Partial<Record<DemoRequestField, string>>;

export type DemoRequestValidationResult =
  | {
      ok: true;
      value: DemoRequestDraft;
    }
  | {
      ok: false;
      errors: DemoRequestErrors;
      firstInvalidField: DemoRequestField;
    };

export type DemoRequestResult =
  | {
      status: "invalid";
      submitted: false;
      message: string;
      errors: DemoRequestErrors;
      firstInvalidField: DemoRequestField;
    }
  | {
      status: "not-configured";
      submitted: false;
      message: string;
      value: DemoRequestDraft;
    };

export const EMPTY_DEMO_REQUEST_DRAFT: Readonly<DemoRequestDraft> =
  Object.freeze({
    nombre: "",
    aerolinea: "",
    cargo: "",
    correoCorporativo: "",
    estacionPais: "",
    necesidadOperativa: "",
  });

export const DEMO_REQUEST_NO_TRANSMISSION_MESSAGE =
  "El canal de envío aún no está habilitado; no se transmitió ninguna información.";

export const DEMO_REQUEST_INVALID_MESSAGE =
  "Revisa los campos indicados antes de continuar.";

const MAX_LENGTHS: Record<DemoRequestField, number> = {
  nombre: 100,
  aerolinea: 120,
  cargo: 120,
  correoCorporativo: 254,
  estacionPais: 120,
  necesidadOperativa: 1_000,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FIELD_LABELS: Record<DemoRequestField, string> = {
  nombre: "nombre",
  aerolinea: "aerolínea",
  cargo: "cargo",
  correoCorporativo: "correo corporativo",
  estacionPais: "estación o país",
  necesidadOperativa: "necesidad operativa",
};

function normalizeDraft(draft: DemoRequestDraft): DemoRequestDraft {
  return {
    nombre: draft.nombre.trim(),
    aerolinea: draft.aerolinea.trim(),
    cargo: draft.cargo.trim(),
    correoCorporativo: draft.correoCorporativo.trim().toLocaleLowerCase("es"),
    estacionPais: draft.estacionPais.trim(),
    necesidadOperativa: draft.necesidadOperativa.trim(),
  };
}

/**
 * Validates and normalizes a local draft. This function performs no I/O.
 */
export function validateDemoRequest(
  draft: DemoRequestDraft,
): DemoRequestValidationResult {
  const value = normalizeDraft(draft);
  const errors: DemoRequestErrors = {};

  for (const field of DEMO_REQUEST_FIELDS) {
    if (value[field].length === 0) {
      errors[field] = `Ingresa tu ${FIELD_LABELS[field]}.`;
      continue;
    }

    if (value[field].length > MAX_LENGTHS[field]) {
      errors[field] = `Usa un máximo de ${MAX_LENGTHS[field]} caracteres.`;
    }
  }

  if (
    value.correoCorporativo.length > 0 &&
    value.correoCorporativo.length <= MAX_LENGTHS.correoCorporativo &&
    !EMAIL_PATTERN.test(value.correoCorporativo)
  ) {
    errors.correoCorporativo = "Ingresa un correo corporativo válido.";
  }

  const firstInvalidField = DEMO_REQUEST_FIELDS.find(
    (field) => errors[field] !== undefined,
  );

  if (firstInvalidField) {
    return { ok: false, errors, firstInvalidField };
  }

  return { ok: true, value };
}

/**
 * Produces the UI result for the current pilot phase. It deliberately never
 * sends, persists, or queues personal information.
 */
export function resolveDemoRequest(draft: DemoRequestDraft): DemoRequestResult {
  const validation = validateDemoRequest(draft);

  if (!validation.ok) {
    return {
      status: "invalid",
      submitted: false,
      message: DEMO_REQUEST_INVALID_MESSAGE,
      errors: validation.errors,
      firstInvalidField: validation.firstInvalidField,
    };
  }

  return {
    status: "not-configured",
    submitted: false,
    message: DEMO_REQUEST_NO_TRANSMISSION_MESSAGE,
    value: validation.value,
  };
}
