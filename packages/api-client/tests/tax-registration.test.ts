import { describe, expect, it } from "vitest";
import { checkTaxRegistration, formatTaxRegistration, normalizedAirlineVerification } from "../src";

describe("airline tax identifier", () => {
  it("is an RNC with its check digit for the Dominican Republic and the airline's own id elsewhere", () => {
    expect(checkTaxRegistration("1-31-23456-9", "do").registration).toEqual({ number: "131234569", countryCode: "DO" });
    expect(checkTaxRegistration("131234568", "DO").problem).toMatch(/dígito verificador/);
    expect(checkTaxRegistration("", "DO").problem).toBe("Escriba el RNC de la aerolínea.");
    expect(checkTaxRegistration(" B85850394 ", "ES").registration).toEqual({ number: "B85850394", countryCode: "ES" });
    expect(checkTaxRegistration("ab", "ES").problem).toBe("El identificador fiscal tiene de 3 a 32 caracteres.");
    expect(checkTaxRegistration("B85850394", "").problem).toMatch(/país/);
    expect(formatTaxRegistration("131234569", "DO")).toBe("RNC 1-31-23456-9");
    expect(formatTaxRegistration("B85850394", "ES")).toBe("Id. fiscal B85850394 (ES)");
  });

  it("travels canonical with the airline verification and is refused when invalid", () => {
    const identity = { expectedVersion: "AAAAAAAAB9E=", legalName: "Caribe S.R.L.", countryCode: "DO", icaoCode: "CCX",
      verificationSourceUrl: "https://aoc.example.test/ccx" };
    expect(normalizedAirlineVerification({ ...identity, taxRegistration: "1-30-00000-1", taxRegistrationCountryCode: "DO" }))
      .toMatchObject({ taxRegistration: "130000001", taxRegistrationCountryCode: "DO" });
    expect(normalizedAirlineVerification(identity)).not.toHaveProperty("taxRegistration");
    expect(() => normalizedAirlineVerification({ ...identity, taxRegistration: "130000002", taxRegistrationCountryCode: "DO" }))
      .toThrow(TypeError);
  });
});
