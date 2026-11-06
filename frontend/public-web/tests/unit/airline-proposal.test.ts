import { describe, expect, it } from "vitest";
import { emptyAirlineProposal, validateAirlineProposal } from "@/lib/airline-proposal";

const valid = { ...emptyAirlineProposal, name: " Caribe Cargo Express ", countryCode: "do", icaoCode: "ccx" };

describe("validateAirlineProposal", () => {
  it("requires only the name, the country and the ICAO code", () => {
    expect(validateAirlineProposal(valid)).toMatchObject({ ok: true, value: { name: "Caribe Cargo Express",
      countryCode: "DO", iataCode: null, icaoCode: "CCX", websiteUrl: null } });
    expect(validateAirlineProposal({ ...valid, iataCode: "c7", websiteUrl: "https://caribecargo.example.com" }))
      .toMatchObject({ ok: true, value: { iataCode: "C7", websiteUrl: "https://caribecargo.example.com" } });
  });

  it("explains each invalid field in Spanish and points to the first one", () => {
    const result = validateAirlineProposal(emptyAirlineProposal);
    expect(result).toMatchObject({ ok: false, firstInvalidField: "name" });
    expect(Object.keys(result.errors)).toEqual(["name", "countryCode", "icaoCode"]);
    for (const [change, field] of [
      [{ iataCode: "12" }, "iataCode"], [{ iataCode: "ZZ" }, "iataCode"], [{ icaoCode: "ZZZ" }, "icaoCode"],
      [{ icaoCode: "CC1" }, "icaoCode"], [{ websiteUrl: "http://caribecargo.example.com" }, "websiteUrl"],
      [{ websiteUrl: "https://user:secret@caribecargo.example.com" }, "websiteUrl"], [{ countryCode: "XX1" }, "countryCode"],
    ] as const)
      expect(validateAirlineProposal({ ...valid, ...change })).toMatchObject({ ok: false, firstInvalidField: field });
  });
});
