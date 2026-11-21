import { expect, it } from "vitest";

import { invoiceFilterQuery, parseInvoiceFilterParams } from "@/lib/invoice-filter-params";

it("reads the filters of «Facturas» from the address, in Spanish", () => {
  expect(parseInvoiceFilterParams(new URLSearchParams(
    "estado=vencidas&desde=2026-10-01&hasta=2026-10-31&estacion=20000000-0000-7000-8000-000000000003&buscar=E31"))).toEqual({
    filters: { status: "Vencida", from: "2026-10-01", to: "2026-10-31", search: "E31" },
    stationId: "20000000-0000-7000-8000-000000000003",
  });
  expect(parseInvoiceFilterParams(new URLSearchParams("estado=con-saldo")).filters).toEqual({ status: "open" });
  expect(parseInvoiceFilterParams(null)).toEqual({ filters: {}, stationId: "" });
});

it("ignores a value it does not understand instead of failing", () => {
  expect(parseInvoiceFilterParams(new URLSearchParams(
    "estado=raro&desde=2026-13-01&hasta=ayer&estacion=<script>&buscar=" + "x".repeat(200)))).toEqual({
    filters: { search: "x".repeat(64) }, stationId: "",
  });
  // A period upside down keeps only its start.
  expect(parseInvoiceFilterParams(new URLSearchParams("desde=2026-11-10&hasta=2026-11-01")).filters)
    .toEqual({ from: "2026-11-10" });
});

it("writes only the filters in use and keeps any other parameter of the address", () => {
  const current = new URLSearchParams("utm=x&estado=pagadas&buscar=viejo");
  expect(invoiceFilterQuery(current, { status: "Pendiente", from: "2026-11-01", search: "  0003 " }, "s1"))
    .toBe("utm=x&estado=pendientes&desde=2026-11-01&estacion=s1&buscar=0003");
  expect(invoiceFilterQuery(current, {}, "")).toBe("utm=x");
  // What it writes, it reads back the same.
  const filters = { status: "Anulada" as const, from: "2026-10-01", to: "2026-10-31", search: "E31" };
  expect(parseInvoiceFilterParams(new URLSearchParams(invoiceFilterQuery(new URLSearchParams(), filters, "s1"))))
    .toEqual({ filters, stationId: "s1" });
});
