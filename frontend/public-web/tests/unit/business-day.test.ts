import { describe, expect, it } from "vitest";
import { BUSINESS_TIME_ZONE, businessToday, formatLocalDateTime } from "@/lib/business-day";

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
});

describe("station local time in the portal (3-N20)", () => {
  it("shows an instant at the station's local time with a 24-hour clock", () => {
    const signed = formatLocalDateTime("2026-09-25T15:50:00Z", "America/Santo_Domingo");
    expect(signed).toContain("11:50");
    expect(signed).toContain("2026");
    expect(signed).not.toMatch(/UTC|p\. m\.|a\. m\./);
    // 01:00Z on 6 November is still 5 November in Punta Cana.
    expect(formatLocalDateTime("2026-11-06T01:00:00Z", "America/Santo_Domingo")).toMatch(/^5 .*21:00$/);
    expect(formatLocalDateTime("2026-09-25T15:50:00Z", "Europe/Madrid")).toContain("17:50");
  });

  it("falls back on AVIAM's calendar for a missing or unknown zone and shows a dash for an invalid instant", () => {
    expect(formatLocalDateTime("2026-09-25T15:50:00Z")).toContain("11:50");
    expect(formatLocalDateTime("2026-09-25T15:50:00Z", "Mars/Olympus_Mons")).toContain("11:50");
    expect(formatLocalDateTime("ayer")).toBe("—");
  });
});
