import { describe, expect, it } from "vitest";
import { identityDocumentExample, normalizeIdentityDocument, normalizePhone } from "../src";

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
    ["RD1234567", "DO", true], ["5050505050RD", "DO", false], ["1234567RD", "DO", false],
    ["X1234567", "ES", true], ["AAAAAA", null, false],
  ] as const)("passport %s (%s) valid=%s", (number, nationality, valid) =>
    expect(normalizeIdentityDocument("Passport", number, nationality) !== null).toBe(valid));

  it("explains the expected format", () =>
    expect(identityDocumentExample("Passport", "DO")).toContain("2 letras"));
});
