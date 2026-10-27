import { describe, expect, it } from "vitest";

import {
  type DivisionsState, effectiveTitle, type RepresentativeDraft, TITLE_OTHER, validateRepresentative,
} from "@/lib/access-request";
import { countryCodes, countryName } from "@/lib/geo/catalog";
import { DOMINICAN_REPUBLIC_DIVISIONS } from "@/lib/geo/dominican-republic";

const valid: RepresentativeDraft = {
  name: "María José Núñez-O'Connor", titleOption: "Gerente de estación", titleCustom: "",
  email: "maria@aerolinea.com", phone: "+1 (809) 555-0100", authorityDeclared: true,
  nationalityCode: "", address: "", country: "DO", province: "25",
  municipality: "Santiago de los Caballeros", district: "", documentType: "", documentNumber: "",
};

const errorsFor = (changes: Partial<RepresentativeDraft>, divisions: DivisionsState = DOMINICAN_REPUBLIC_DIVISIONS) => {
  const result = validateRepresentative({ ...valid, ...changes }, divisions);
  return result.ok ? {} : result.errors;
};

describe("Dominican Republic catalog", () => {
  it("contains the 32 official provinces and 158 municipalities without duplicates", () => {
    expect(DOMINICAN_REPUBLIC_DIVISIONS).toHaveLength(32);
    expect(new Set(DOMINICAN_REPUBLIC_DIVISIONS.map((division) => division.code)).size).toBe(32);
    expect(new Set(DOMINICAN_REPUBLIC_DIVISIONS.map((division) => division.name)).size).toBe(32);
    expect(DOMINICAN_REPUBLIC_DIVISIONS.flatMap((division) => division.cities)).toHaveLength(158);
    for (const division of DOMINICAN_REPUBLIC_DIVISIONS)
      expect(new Set(division.cities).size).toBe(division.cities.length);
  });

  it("is a selectable country with its Spanish name", () => {
    expect(countryCodes).toContain("DO");
    expect(countryName("DO")).toBe("República Dominicana");
  });
});

describe("validateRepresentative", () => {
  it("accepts a complete representative with international characters", () => {
    expect(validateRepresentative(valid, DOMINICAN_REPUBLIC_DIVISIONS)).toEqual({ ok: true });
  });

  it("reports empty and whitespace-only required fields", () => {
    const errors = errorsFor({ name: "   ", titleOption: "", email: " ", phone: "", country: "",
      province: "", municipality: "", authorityDeclared: false });
    expect(errors).toEqual({
      name: "Ingrese su nombre completo.", titleOption: "Seleccione su cargo.",
      email: "Ingrese su correo electrónico corporativo.", phone: "Ingrese su teléfono.",
      country: "Seleccione su país.",
      authorityDeclared: "Confirme que está autorizado para presentar la solicitud.",
    });
  });

  it.each(["J0hn Smith", "<script>", "A", "John_Smith"])("rejects the name %s", (name) => {
    expect(errorsFor({ name }).name).toBeDefined();
  });

  it.each(["usuario@", "usuario@empresa", "usuario empresa@x.com", "a..b@empresa.com", "@empresa.com"])(
    "rejects the email %s", (email) => {
      expect(errorsFor({ email }).email).toBe("Ingrese un correo electrónico válido.");
    });

  it.each(["849-246-3371", "8492463371", "1 (849) 246-3371", "+34 600 123 456"])(
    "accepts the phone %s without forcing the + prefix", (phone) => {
      expect(errorsFor({ phone }).phone).toBeUndefined();
    });

  it.each(["123", "305-555-0100", "+1 809", "+1 809 555 0100 1234 5678", "+1 809-555-ABCD"])(
    "rejects the phone %s", (phone) => {
      expect(errorsFor({ phone }).phone).toMatch(/teléfono dominicano de 10 dígitos/);
    });

  it("requires a valid custom title only when Otro is selected", () => {
    expect(errorsFor({ titleOption: TITLE_OTHER }).titleCustom).toBe("Escriba su cargo.");
    expect(errorsFor({ titleOption: TITLE_OTHER, titleCustom: "!!!" }).titleCustom).toBeDefined();
    expect(errorsFor({ titleOption: TITLE_OTHER, titleCustom: "x".repeat(121) }).titleCustom).toBeDefined();
    expect(errorsFor({ titleOption: TITLE_OTHER, titleCustom: "Jefe de escala" })).toEqual({});
    expect(errorsFor({ titleOption: "Inventado" }).titleOption).toBeDefined();
    expect(effectiveTitle({ titleOption: TITLE_OTHER, titleCustom: "  Jefe de escala " })).toBe("Jefe de escala");
    expect(effectiveTitle({ titleOption: "Gerente regional", titleCustom: "ignorado" })).toBe("Gerente regional");
  });

  it("rejects divisions and municipalities outside the selected parent", () => {
    expect(errorsFor({ country: "XX" }).country).toBeDefined();
    expect(errorsFor({ province: "" }).province).toBe("Seleccione la provincia, estado o región.");
    expect(errorsFor({ province: "CA" }).province).toBeDefined();
    expect(errorsFor({ municipality: "" }).municipality).toBe("Seleccione el municipio o ciudad.");
    expect(errorsFor({ municipality: "Higüey" }).municipality).toBeDefined();
    expect(errorsFor({}, null).province).toMatch(/Espere/);
  });

  it("skips division and municipality when the country has none", () => {
    expect(errorsFor({ country: "VA", province: "", municipality: "" }, [])).toEqual({});
    expect(errorsFor({ country: "MC", province: "X", municipality: "" },
      [{ code: "X", name: "Sin ciudades", cities: [] }])).toEqual({});
  });

  it("requires document type and number together", () => {
    expect(errorsFor({ documentType: "Passport" }).documentNumber).toBeDefined();
    expect(errorsFor({ documentNumber: "AB123" }).documentType).toBeDefined();
    expect(errorsFor({ documentType: "Passport", documentNumber: "A1" }).documentNumber).toBeDefined();
    expect(errorsFor({ documentType: "Passport", documentNumber: "X1234567", nationalityCode: "ES" })).toEqual({});
  });

  it("validates each document by its real format", () => {
    expect(errorsFor({ documentType: "Passport", documentNumber: "RD1234567", nationalityCode: "DO" })).toEqual({});
    expect(errorsFor({ documentType: "Passport", documentNumber: "5050505050RD", nationalityCode: "DO" }).documentNumber)
      .toMatch(/RD1234567 \(2 letras y 7 dígitos\)/);
    expect(errorsFor({ documentType: "NationalId", documentNumber: "001-1234567-3" })).toEqual({});
    expect(errorsFor({ documentType: "NationalId", documentNumber: "001-1234567-8" }).documentNumber)
      .toMatch(/dígito verificador/);
  });

  it("accepts only municipal districts of the chosen municipality", async () => {
    const { DOMINICAN_REPUBLIC_DIVISIONS } = await import("../../src/lib/geo/dominican-republic");
    const base = { country: "DO", province: "08", municipality: "El Seibo" };
    expect(errorsFor({ ...base, district: "Pedro Sánchez" }, DOMINICAN_REPUBLIC_DIVISIONS)).toEqual({});
    expect(errorsFor({ ...base, district: "La Gina" }, DOMINICAN_REPUBLIC_DIVISIONS).district).toBeDefined();
    expect(DOMINICAN_REPUBLIC_DIVISIONS.find(item => item.code === "08")?.cities).toEqual(["El Seibo", "Miches"]);
  });
});
