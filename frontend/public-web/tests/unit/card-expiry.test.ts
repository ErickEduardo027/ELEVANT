import { afterEach, describe, expect, it, vi } from "vitest";

import { businessToday } from "@/lib/business-day";
import { CARD_EXPIRY_ERRORS, CARD_EXPIRY_HINT, formatCardExpiry, parseCardExpiry } from "@/lib/card-expiry";

/** What the field shows after typing `keys` one by one at the end: every change goes through the formatter. */
const typed = (keys: string, from = "") => [...keys].reduce((value, key) => formatCardExpiry(value + key, value), from);

/** What the field shows after erasing `count` characters from the end with backspace. */
const erased = (value: string, count = 1) => Array.from({ length: count })
  .reduce<string>(current => formatCardExpiry(current.slice(0, -1), current), value);

afterEach(() => { vi.useRealTimers(); });

describe("formatCardExpiry (S4)", () => {
  it("adds the slash after the two digits of the month", () => {
    expect(typed("1")).toBe("1");
    expect(typed("12")).toBe("12/");
    expect(typed("1228")).toBe("12/28");
    expect(typed("122028")).toBe("12/2028");
  });

  it("pads a one-digit month closed by a separator: «1/» is «01/», also in M/AAAA", () => {
    expect(typed("1/")).toBe("01/");
    expect(typed("1/28")).toBe("01/28");
    expect(typed("1 2028")).toBe("01/2028");
    expect(formatCardExpiry("1/2028")).toBe("01/2028");
  });

  it("reads spaces, dashes and dots as the slash and drops any other character", () => {
    for (const pasted of ["1228", "12 28", "12-28", "12.28", "12 / 28", "12//28", " 12/28 ", "12a28"])
      expect(formatCardExpiry(pasted), pasted).toBe("12/28");
    expect(formatCardExpiry("12 2028")).toBe("12/2028");
    // The slash typed after the one the field added is not doubled.
    expect(typed("12/")).toBe("12/");
  });

  it("does not put back the slash that backspace erased", () => {
    expect(erased("12/")).toBe("12");
    expect(erased("01/")).toBe("01");
    expect(erased("12/28", 3)).toBe("12");
    expect(erased("1")).toBe("");
    // Typing again after erasing it adds the slash once more.
    expect(typed("3", "12")).toBe("12/3");
  });

  it("keeps MM/AAAA at most, also when a longer value is pasted", () => {
    expect(formatCardExpiry("12/20281")).toBe("12/2028");
    expect(formatCardExpiry("1220289999")).toBe("12/2028");
    expect(typed("1220289")).toBe("12/2028");
  });
});

describe("parseCardExpiry (S4)", () => {
  const today = "2026-11-19";

  it.each([
    ["12/30", 12, 2030], ["1230", 12, 2030], ["12 30", 12, 2030], ["12-30", 12, 2030], ["122030", 12, 2030],
    ["12/2030", 12, 2030], ["1/30", 1, 2030], ["1/2030", 1, 2030], [" 08 / 29 ", 8, 2029],
  ])("reads %j as month %i of %i", (value, month, year) => {
    expect(parseCardExpiry(value, today)).toEqual({ ok: true, month, year });
  });

  it.each([
    ["", "format"], ["12", "format"], ["12/", "format"], ["12/3", "format"], ["12/030", "format"], ["130", "format"],
    ["12/30/1", "format"], ["13/30", "month"], ["00/30", "month"], ["12/2100", "year"], ["12/1999", "year"],
    ["10/26", "expired"], ["12/25", "expired"],
  ])("refuses %j: %s", (value, reason) => {
    expect(parseCardExpiry(value, today)).toEqual({ ok: false, reason });
  });

  it("keeps a card valid through the last day of its month, like the API", () => {
    expect(parseCardExpiry("11/26", "2026-11-30")).toEqual({ ok: true, month: 11, year: 2026 });
    expect(parseCardExpiry("11/2026", "2026-12-01")).toEqual({ ok: false, reason: "expired" });
    expect(parseCardExpiry("12/26", "2026-12-31")).toEqual({ ok: true, month: 12, year: 2026 });
    expect(parseCardExpiry("12/26", "2027-01-01")).toEqual({ ok: false, reason: "expired" });
  });

  it("counts today's business day in Santo Domingo by default, not the UTC day", () => {
    // 00:30Z on 1 December is 20:30 of 30 November in Santo Domingo: a card of 11/26 still pays.
    vi.setSystemTime(new Date("2026-12-01T00:30:00Z"));
    expect(parseCardExpiry("11/26")).toEqual({ ok: true, month: 11, year: 2026 });
    vi.setSystemTime(new Date("2026-12-01T04:30:00Z"));
    expect(businessToday()).toBe("2026-12-01");
    expect(parseCardExpiry("11/26")).toEqual({ ok: false, reason: "expired" });
  });

  it("explains each reason in Spanish, treating the airline as usted (D-N19)", () => {
    expect(CARD_EXPIRY_HINT).toBe("Mes y año como aparecen en la tarjeta, por ejemplo 08/29.");
    expect(CARD_EXPIRY_ERRORS).toEqual({
      format: "Escriba el mes y el año del vencimiento, por ejemplo 08/29.",
      month: "El mes del vencimiento debe estar entre 01 y 12.",
      year: "Revise el año del vencimiento.",
      expired: "La fecha de vencimiento ya pasó. Use una tarjeta vigente.",
    });
  });
});
