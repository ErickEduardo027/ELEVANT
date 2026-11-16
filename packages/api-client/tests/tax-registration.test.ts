import { describe, expect, it } from "vitest";
import { checkTaxRegistration, formatTaxRegistration, maskRnc, normalizedAirlineVerification, rncFeedback } from "../src";

describe("airline tax identifier", () => {
  it("is an RNC of 9 digits for the Dominican Republic and the airline's own id elsewhere", () => {
    expect(checkTaxRegistration("1-31-23456-9", "do").registration).toEqual({ number: "131234569", countryCode: "DO" });
    // Its check digit is not verified: any 9 digits are an RNC; fewer or more are not.
    expect(checkTaxRegistration("1-31-23456-8", "DO").registration).toEqual({ number: "131234568", countryCode: "DO" });
    expect(checkTaxRegistration("13123456", "DO").problem).toBe("El RNC tiene 9 dígitos.");
    expect(checkTaxRegistration("1312345690", "DO").problem).toBe("El RNC tiene 9 dígitos.");
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
    expect(() => normalizedAirlineVerification({ ...identity, taxRegistration: "13000000", taxRegistrationCountryCode: "DO" }))
      .toThrow(TypeError);
  });

  it("masks an RNC while it is typed and keeps the 9 digits when it is checked", () => {
    expect(["", "1", "13", "131", "1312", "13123456", "131234569", "1312345699", "1-31-23456-9", "rnc 13a1"].map(maskRnc))
      .toEqual(["", "1", "1-3", "1-31", "1-31-2", "1-31-23456", "1-31-23456-9", "1-31-23456-9", "1-31-23456-9", "1-31"]);
    expect(checkTaxRegistration(maskRnc("131234569"), "DO").registration).toEqual({ number: "131234569", countryCode: "DO" });
    expect(rncFeedback("1-31-23456")).toBeNull();
    expect(rncFeedback("1-31-23456-9")).toEqual({ valid: true, message: "RNC válido" });
    expect(rncFeedback("1-31-23456-8")).toEqual({ valid: true, message: "RNC válido" });
  });
});
