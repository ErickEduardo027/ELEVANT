import { describe, expect, it, vi } from "vitest";

import {
  DEMO_REQUEST_FIELDS,
  DEMO_REQUEST_INVALID_MESSAGE,
  DEMO_REQUEST_NO_TRANSMISSION_MESSAGE,
  EMPTY_DEMO_REQUEST_DRAFT,
  resolveDemoRequest,
  validateDemoRequest,
  type DemoRequestDraft,
} from "@/lib/demo-request";

const validDraft: DemoRequestDraft = {
  nombre: "Ana Pérez",
  aerolinea: "Aerolínea Ejemplo",
  cargo: "Gerente de operaciones",
  correoCorporativo: "ana@aerolinea.example",
  estacionPais: "PUJ · República Dominicana",
  necesidadOperativa: "Trazabilidad de servicios en rampa.",
};

describe("validateDemoRequest", () => {
  it("accepts a complete draft and normalizes user-entered whitespace", () => {
    const result = validateDemoRequest({
      ...validDraft,
      nombre: "  Ana Pérez  ",
      correoCorporativo: "  ANA@AEROLINEA.EXAMPLE ",
      necesidadOperativa: "  Trazabilidad de servicios en rampa.  ",
    });

    expect(result).toEqual({
      ok: true,
      value: validDraft,
    });
  });

  it("does not mutate the caller's draft", () => {
    const draft = {
      ...validDraft,
      nombre: "  Ana Pérez  ",
    };

    validateDemoRequest(draft);

    expect(draft.nombre).toBe("  Ana Pérez  ");
  });

  it("reports every required field in stable form order", () => {
    const result = validateDemoRequest({ ...EMPTY_DEMO_REQUEST_DRAFT });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an invalid result");

    expect(Object.keys(result.errors)).toEqual(DEMO_REQUEST_FIELDS);
    expect(result.firstInvalidField).toBe("nombre");
    expect(result.errors).toEqual({
      nombre: "Ingresa tu nombre.",
      aerolinea: "Ingresa tu aerolínea.",
      cargo: "Ingresa tu cargo.",
      correoCorporativo: "Ingresa tu correo corporativo.",
      estacionPais: "Ingresa tu estación o país.",
      necesidadOperativa: "Ingresa tu necesidad operativa.",
    });
  });

  it.each([
    "ana",
    "ana@",
    "@aerolinea.example",
    "ana @aerolinea.example",
    "ana@aerolinea",
  ])("rejects the invalid email %s", (correoCorporativo) => {
    const result = validateDemoRequest({
      ...validDraft,
      correoCorporativo,
    });

    expect(result).toMatchObject({
      ok: false,
      firstInvalidField: "correoCorporativo",
      errors: {
        correoCorporativo: "Ingresa un correo corporativo válido.",
      },
    });
  });

  it("reports length limits after trimming", () => {
    const result = validateDemoRequest({
      ...validDraft,
      aerolinea: `  ${"a".repeat(121)}  `,
      necesidadOperativa: "n".repeat(1_001),
    });

    expect(result).toMatchObject({
      ok: false,
      firstInvalidField: "aerolinea",
      errors: {
        aerolinea: "Usa un máximo de 120 caracteres.",
        necesidadOperativa: "Usa un máximo de 1000 caracteres.",
      },
    });
  });
});

describe("resolveDemoRequest", () => {
  it("returns validation feedback without claiming a submission", () => {
    const result = resolveDemoRequest({
      ...validDraft,
      nombre: "",
    });

    expect(result).toMatchObject({
      status: "invalid",
      submitted: false,
      message: DEMO_REQUEST_INVALID_MESSAGE,
      firstInvalidField: "nombre",
    });
  });

  it("returns the explicit no-transmission result for valid data", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = resolveDemoRequest(validDraft);

    expect(result).toEqual({
      status: "not-configured",
      submitted: false,
      message: DEMO_REQUEST_NO_TRANSMISSION_MESSAGE,
      value: validDraft,
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
