import { describe, expect, it } from "vitest";
import { checkIdentityDocument, identityDocumentExample, normalizeIdentityDocument, normalizePhone } from "../src";

const withLuhn = (ten: string) => {
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const product = Number(ten[index]) * (index % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  return ten + String((10 - sum % 10) % 10);
};

describe("phone normalization (mirrors PhoneNumbers.cs)", () => {
  it.each([
    ["849-246-3371", "+18492463371"],
    ["8492463371", "+18492463371"],
    ["(809) 555 0100", "+18095550100"],
    ["1-829-555-0100", "+18295550100"],
    ["+34 600 123 456", "+34600123456"],
    ["0034 600 123 456", "+34600123456"],
  ])("accepts %s", (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(["305-555-0100", "555-0100", "+1 849 246 337", "849-ABC-3371", ""])("rejects %s",
    (input) => expect(normalizePhone(input)).toBeNull());
});

describe("identity documents (mirrors IdentityDocuments.cs)", () => {
  it("checks the cédula check digit in any layout", () => {
    const cedula = withLuhn("0011234567");
    expect(normalizeIdentityDocument("Cedula", `${cedula.slice(0, 3)}-${cedula.slice(3, 10)}-${cedula[10]}`)).toBe(cedula);
    expect(normalizeIdentityDocument("Cedula", cedula.slice(0, 10) + String((Number(cedula[10]) + 1) % 10))).toBeNull();
  });

  it.each([
    ["RD1234567", "DO", true], ["rd 123 4567", "DO", true], ["AB1234567", "DO", false],
    ["5050505050RD", "DO", false], ["1234567RD", "DO", false], ["RD12345678", "DO", false],
    ["123456789", "US", true], ["A12345678", "US", true], ["AB1234567", "US", false],
    ["AB123456", "CA", true], ["A123456BC", "CA", true], ["A1234567", "CA", false],
    ["X1234567", "ES", true], ["AAAAAA", null, false],
  ] as const)("passport %s (%s) valid=%s", (number, nationality, valid) =>
    expect(normalizeIdentityDocument("Passport", number, nationality) !== null).toBe(valid));

  it("explains the expected format", () =>
    expect(identityDocumentExample("Passport", "DO")).toBe("RD1234567 (RD y 7 dígitos)"));

  // Same messages as IdentityValidationTests.ExplainsTheFirstWrongPosition in .NET.
  it.each([
    ["Passport", "AB1234567", "DO", "El pasaporte dominicano: la posición 1 debe ser «R»; encontramos «A». Formato: RD1234567."],
    ["Passport", "RD12345X7", "DO", "El pasaporte dominicano: la posición 8 debe ser un dígito; encontramos «X». Formato: RD1234567."],
    ["Passport", "RD123456", "DO", "El pasaporte dominicano tiene 9 caracteres; escribiste 8."],
    ["Cedula", "001-12345A7-8", null, "La posición 9 de la cédula debe ser un dígito; encontramos «A»."],
    ["Cedula", "0011234567", null, "La cédula tiene 11 dígitos (3 de oficina, 7 de secuencia y 1 verificador); escribiste 10."],
    ["Passport", "RD-123*4567", "DO", "El carácter «*» no es válido; usa solo letras y dígitos."],
  ] as const)("%s %s explains the first wrong position", (kind, number, nationality, problem) =>
    expect(checkIdentityDocument(kind, number, nationality).problem).toBe(problem));
});
