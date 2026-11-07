import { describe, expect, it } from "vitest";
import { addDays, BUSINESS_TIME_ZONE, businessToday } from "@/lib/business-day";

describe("business day (2-F)", () => {
  it("is the day in Santo Domingo, not the UTC day", () => {
    expect(BUSINESS_TIME_ZONE).toBe("America/Santo_Domingo");
    // 21:00 on 5 November in Santo Domingo is already 6 November in UTC.
    expect(businessToday(new Date("2026-11-06T01:00:00Z"))).toBe("2026-11-05");
    expect(businessToday(new Date("2026-11-06T04:00:00Z"))).toBe("2026-11-06");
  });

  it("uses the station zone when given and falls back on an unknown one", () => {
    const instant = new Date("2026-11-06T01:00:00Z");
    expect(businessToday(instant, "Europe/Madrid")).toBe("2026-11-06");
    expect(businessToday(instant, "Mars/Olympus_Mons")).toBe("2026-11-05");
  });

  it("moves an ISO date by whole calendar days, across months and years", () => {
    expect(addDays("2027-01-15", -1)).toBe("2027-01-14");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(() => addDays("15/01/2027", -1)).toThrow(TypeError);
    expect(() => addDays("2027-01-15", 0.5)).toThrow(TypeError);
  });
});
