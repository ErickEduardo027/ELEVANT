import { afterEach, expect, it, vi } from "vitest";

import { downloadFile } from "@/lib/download-file";
import { formatAmount, formatDate, formatDateTime, formatMoney } from "@/lib/portal-format";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("formats money the Dominican way with the currency code and 2 decimals", () => {
  expect(formatMoney("USD", 1234567.5)).toBe("USD 1,234,567.50");
  expect(formatMoney("DOP", 0)).toBe("DOP 0.00");
  expect(formatMoney("USD", -18)).toBe("USD -18.00");
  // Never 4 decimals: a rate of the ledger is rounded for the airline.
  expect(formatMoney("USD", 10.12345)).toBe("USD 10.12");
  expect(formatAmount(148.09)).toBe("148.09");
});

it("writes a calendar date as dd/mm/aaaa without moving its day", () => {
  expect(formatDate("2026-12-05")).toBe("05/12/2026");
  expect(formatDate(null)).toBe("—");
  expect(formatDate("not a date")).toBe("—");
});

it("writes an instant in the station's zone, not in UTC", () => {
  // 01:30 UTC on 21/11 is still 20/11 at 21:30 in Santo Domingo.
  expect(formatDate("2026-11-21T01:30:00Z", "America/Santo_Domingo")).toBe("20/11/2026");
  expect(formatDateTime("2026-11-21T01:30:00Z", "America/Santo_Domingo")).toBe("20/11/2026 21:30");
  // An unknown zone falls back to AVIAM's calendar.
  expect(formatDateTime("2026-11-21T01:30:00Z", "Mars/Olympus")).toBe("20/11/2026 21:30");
});

it("downloads a file and revokes its URL one second later, not before the browser reads it", () => {
  vi.useFakeTimers();
  const createObjectURL = vi.fn(() => "blob:file");
  const revokeObjectURL = vi.fn();
  Object.assign(URL, { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  downloadFile(new Blob(["%PDF-1.7"]), "factura-E310000000001.pdf");
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector("a[download]")).toBeNull();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(999);
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:file");
});
