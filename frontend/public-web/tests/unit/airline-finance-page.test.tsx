import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AirlineFinancePage } from "@/components/portal/AirlineFinancePage";
import { AirlineInvoiceDetailPage } from "@/components/portal/AirlineInvoiceDetailPage";
import { AirlineStatementPage } from "@/components/portal/AirlineTreasuryPanel";
import type { AirlineTreasuryInvoice, AirlineTreasuryInvoiceDetail, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";

const actor = { accountId: "40000000-0000-7000-8000-000000000003" };
const bootstrap: { stations: { id: string; code: string; name: string; ianaTimeZone: string }[] } = { stations: [] };
let financeRevision = 0;
const getTreasuryStatement = vi.fn<(asOf: string, stationId?: string, signal?: AbortSignal) => Promise<AirlineTreasuryStatement>>();
const getTreasuryInvoice = vi.fn<(id: string, signal?: AbortSignal) => Promise<AirlineTreasuryInvoiceDetail>>();
const getTreasuryReceipt = vi.fn();
const getAdjustmentNoteDocument = vi.fn<(noteId: string) => Promise<Blob>>();
const getInvoiceDocument = vi.fn(async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }));
const getInvoiceCardPayments = vi.fn(async (invoiceId: string) => ({ invoiceId, attempts: [] }));
const getCardPaymentAvailability = vi.fn(async () => ({ available: true, simulated: true }));
const payInvoiceByCard = vi.fn();
const getCardPaymentReceipt = vi.fn();

// The address is the browser's own: the page reads its filters from it and writes them back with replaceState.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({ status: "ready", session: { actor, bootstrap }, getTreasuryStatement, getTreasuryInvoice,
    getTreasuryReceipt, getAdjustmentNoteDocument, getInvoiceDocument, getInvoiceCardPayments, getCardPaymentAvailability,
    payInvoiceByCard, getCardPaymentReceipt, financeRevision }),
}));

const invoice = (overrides: Partial<AirlineTreasuryInvoice> = {}): AirlineTreasuryInvoice => ({
  id: "74000000-0000-7000-8000-000000000009", preinvoiceId: "74000000-0000-7000-8000-000000000001",
  number: "NF-74000000000070008000000000000009", fiscalNumber: "E310000000001", stationId: "s1", stationCode: "PUJ",
  currencyCode: "USD", total: 118, legacyPaid: 0, legacyCredited: 0, applied: 118, credited: 18, debited: 0, balance: -18,
  dueDate: "2026-12-05", daysOverdue: 0, agingBucket: "Current", ...overrides,
});
const statement = (invoices: AirlineTreasuryInvoice[], aging: AirlineTreasuryStatement["aging"] = []): AirlineTreasuryStatement =>
  ({ airlineId: "20000000-0000-7000-8000-000000000001", asOf: "2026-11-09", invoices, receipts: [], movements: [], aging });
const usd = { currencyCode: "USD", balance: -18, current: 0, days1To30: 0, days31To60: 0, days61To90: 0, days91Plus: 0,
  unallocated: 800, creditBalance: 18 };

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  financeRevision = 0;
  getTreasuryStatement.mockReset();
  getTreasuryInvoice.mockReset();
  getAdjustmentNoteDocument.mockReset();
});

it("keeps the invoices on screen while they are read again and after a failed read (4-N25)", async () => {
  getTreasuryStatement.mockResolvedValueOnce(statement([invoice()]));
  const page = render(<AirlineFinancePage airlineName="Demo Airlines" />);
  expect(await screen.findByRole("link", { name: "E310000000001" })).toBeInTheDocument();

  let fail!: (error: unknown) => void;
  getTreasuryStatement.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  financeRevision += 1;
  page.rerender(<AirlineFinancePage airlineName="Demo Airlines" />);
  expect(await screen.findByRole("status")).toHaveTextContent("Actualizando…");
  expect(screen.getByRole("link", { name: "E310000000001" })).toBeInTheDocument();
  expect(screen.queryByText("Cargando facturas autorizadas…")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Descargar PDF de Factura E310000000001" })).toBeInTheDocument();

  await act(async () => fail(new TypeError("Failed to fetch")));
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("No se pudo actualizar. Mostramos los últimos datos.");
  expect(screen.getByRole("link", { name: "E310000000001" })).toBeInTheDocument();
  expect(screen.queryByText("No se pudieron consultar las facturas.")).not.toBeInTheDocument();

  getTreasuryStatement.mockResolvedValueOnce(statement([invoice(), invoice({ id: "74000000-0000-7000-8000-000000000019",
    fiscalNumber: "E310000000002", balance: 50, applied: 0, credited: 0 })]));
  fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("link", { name: "E310000000002" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("shows the airline's credit in its favour and links the statement, which has its own page (4-N30)", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice()], [usd]));
  const page = render(<AirlineFinancePage airlineName="Demo Airlines" />);
  const summary = await screen.findByLabelText("Resumen de facturas");
  // The credit note beyond what was paid (18) and the receipt not applied yet (800).
  expect(within(summary).getByText("Saldo a favor").nextSibling).toHaveTextContent("USD 818.00");
  expect(screen.getByRole("row", { name: /E310000000001/ })).toHaveTextContent("Pagada");

  const views = screen.getByRole("navigation", { name: "Vista de la cuenta financiera" });
  expect(within(views).getByRole("link", { name: "Facturas" })).toHaveAttribute("aria-current", "page");
  expect(within(views).getByRole("link", { name: "Estado de cuenta" })).toHaveAttribute("href", "/portal/finanzas/estado-de-cuenta");
  page.unmount();

  render(<AirlineStatementPage airlineName="Demo Airlines" />);
  const panel = await screen.findByRole("region", { name: "Estado de cuenta de aerolínea" });
  expect(await within(panel).findByText("Crédito a favor")).toBeInTheDocument();
  expect(within(panel).getByText("Cobros sin aplicar")).toBeInTheDocument();
  expect(within(panel).getByRole("button", { name: "Ver factura E310000000001" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Estado de cuenta" })).toHaveAttribute("aria-current", "page");
});

it("gives each KPI its context and filters the loaded invoices by status, period and number", async () => {
  const pending = invoice({ id: "74000000-0000-7000-8000-000000000019", fiscalNumber: "E310000000002", applied: 0, credited: 0,
    balance: 118 });
  const overdue = invoice({ id: "74000000-0000-7000-8000-000000000029", fiscalNumber: "E310000000003", applied: 18, credited: 0,
    balance: 100, daysOverdue: 9 });
  getTreasuryStatement.mockResolvedValue({ ...statement([invoice(), pending, overdue]), movements: [
    { id: "i1", receiptId: null, invoiceId: invoice().id, kind: "Invoice", currencyCode: "USD", amount: 118, effectiveOn: "2026-10-01",
      recordedAt: "2026-10-01T12:00:00Z", reversesId: null, reference: "E310000000001" },
    { id: "i2", receiptId: null, invoiceId: pending.id, kind: "Invoice", currencyCode: "USD", amount: 118, effectiveOn: "2026-11-02",
      recordedAt: "2026-11-02T12:00:00Z", reversesId: null, reference: "E310000000002" },
    { id: "i3", receiptId: null, invoiceId: overdue.id, kind: "Invoice", currencyCode: "USD", amount: 118, effectiveOn: "2026-10-20",
      recordedAt: "2026-10-20T12:00:00Z", reversesId: null, reference: "E310000000003" }] });
  render(<AirlineFinancePage airlineName="Demo Airlines" />);
  const summary = await screen.findByLabelText("Resumen de facturas");
  expect(within(summary).getByText("Facturas con saldo").nextSibling).toHaveTextContent("2 de 3");
  expect(within(summary).getByText("Saldo pendiente").parentElement).toHaveTextContent("USD 218.00de USD 354.00 facturado");
  expect(within(summary).getByText("Vencido").parentElement).toHaveTextContent("USD 100.001 factura vencida de 2 con saldo");
  expect(within(summary).getByText("Cobrado").parentElement).toHaveTextContent("USD 136.00de USD 354.00 facturado");

  const table = screen.getByRole("table", { name: "Facturas" });
  expect(within(table).getByRole("row", { name: /E310000000002/ })).toHaveTextContent("02/11/2026");
  expect(within(table).getByRole("row", { name: /E310000000003/ })).toHaveTextContent("9 días de atraso");
  expect(within(table).getByRole("row", { name: /^Total \(3 facturas\)/ })).toHaveTextContent("USD 354.00USD 200.00");
  expect(screen.getByRole("link", { name: "Ver detalle de Factura E310000000002" }))
    .toHaveAttribute("href", "/portal/finanzas/facturas/74000000-0000-7000-8000-000000000019");

  fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "open" } });
  expect(within(table).queryByRole("row", { name: /E310000000001/ })).not.toBeInTheDocument();
  expect(within(table).getByRole("row", { name: /^Total \(2 facturas\)/ })).toHaveTextContent("USD 236.00USD 218.00");
  fireEvent.change(screen.getByLabelText("Emitidas desde"), { target: { value: "2026-11-01" } });
  expect(within(table).getAllByRole("row").filter(row => /E31/.test(row.textContent ?? ""))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
  fireEvent.change(screen.getByLabelText("Número de factura"), { target: { value: "0003" } });
  expect(screen.getByText("1 factura coincide con los filtros, de 3.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Número de factura"), { target: { value: "ZZZ" } });
  expect(screen.getByText("Ninguna factura coincide con los filtros.")).toBeInTheDocument();
});

it("asks the API for the invoices of the station chosen", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice()]));
  bootstrap.stations = [{ id: "s1", code: "PUJ", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }];
  try {
    render(<AirlineFinancePage airlineName="Demo Airlines" />);
    fireEvent.change(await screen.findByLabelText("Estación"), { target: { value: "s1" } });
    await waitFor(() => expect(getTreasuryStatement).toHaveBeenLastCalledWith(expect.any(String), "s1", expect.any(AbortSignal)));
  } finally {
    bootstrap.stations = [];
  }
});

it("lists the invoice's credit notes by their e-NCF with a PDF that recovers from a failed download (4-N17)", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice()]));
  getTreasuryInvoice.mockResolvedValue({ invoice: invoice(), lines: [], movements: [
    { id: "m-1", receiptId: null, invoiceId: invoice().id, kind: "Credit", currencyCode: "USD", amount: 18,
      effectiveOn: "2026-11-09", recordedAt: "2026-11-09T15:00:00Z", reversesId: null, reference: "E340000000001" }],
  notes: [{ id: "75000000-0000-7000-8000-000000000001", number: "E340000000001", invoiceId: invoice().id, relatedNoteId: null,
    kind: "Credit", currencyCode: "USD", amount: 18, effectiveOn: "2026-11-09", reason: "Servicio no prestado completo",
    recordedAt: "2026-11-09T15:00:00Z", lines: [] }] });
  render(<AirlineInvoiceDetailPage invoiceId={invoice().id} />);
  const notes = await screen.findByRole("region", { name: "Notas de crédito y débito" });
  expect(within(notes).getByRole("row", { name: /Nota de crédito electrónica E340000000001/ })).toHaveTextContent("USD 18.00");
  // The note is listed with its PDF, not as a payment.
  expect(screen.getByRole("region", { name: "Pagos de la factura" })).toHaveTextContent("Sin pagos registrados.");

  getAdjustmentNoteDocument.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const button = within(notes).getByRole("button", { name: "Descargar PDF de Nota de crédito electrónica E340000000001" });
  fireEvent.click(button);
  expect(await within(notes).findByRole("alert")).toHaveTextContent("No se pudo descargar el PDF de la nota. Inténtelo de nuevo.");
  expect(within(notes).getByText(/E340000000001/)).toBeInTheDocument();

  const createObjectURL = vi.fn(() => "blob:note");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  getAdjustmentNoteDocument.mockResolvedValueOnce(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
  fireEvent.click(button);
  await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  expect(getAdjustmentNoteDocument).toHaveBeenLastCalledWith("75000000-0000-7000-8000-000000000001");
  await waitFor(() => expect(within(notes).queryByRole("alert")).not.toBeInTheDocument());
});

// N19: Finanzas addresses the airline as usted, like the rest of the portal.
it("addresses the airline as usted in its invoices and their failed reads (N19)", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice()]));
  getTreasuryInvoice.mockRejectedValue(new TypeError("Failed to fetch"));
  const list = render(<AirlineFinancePage airlineName="Demo Airlines" />);
  expect(screen.getByText("Facturas emitidas por AVIAM por las operaciones completadas, con su vencimiento y saldo, "
    + "y el estado de cuenta de su aerolínea.")).toBeInTheDocument();
  list.unmount();
  render(<AirlineInvoiceDetailPage invoiceId={invoice().id} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo consultar la factura. Inténtelo de nuevo.");
});

it("opens with the filters of the address and writes each change back to it, so the list can be reloaded or shared", async () => {
  const pending = invoice({ id: "74000000-0000-7000-8000-000000000019", fiscalNumber: "E310000000002", applied: 0, credited: 0,
    balance: 118 });
  const overdue = invoice({ id: "74000000-0000-7000-8000-000000000029", fiscalNumber: "E310000000003", applied: 18, credited: 0,
    balance: 100, daysOverdue: 9 });
  getTreasuryStatement.mockResolvedValue(statement([invoice(), pending, overdue]));
  bootstrap.stations = [{ id: "s1", code: "PUJ", name: "Punta Cana", ianaTimeZone: "America/Santo_Domingo" }];
  window.history.replaceState(null, "", "/portal/finanzas?ref=correo&estado=con-saldo&estacion=s1&buscar=0003#tabla");
  try {
    render(<AirlineFinancePage airlineName="Demo Airlines" />);
    const table = await screen.findByRole("table", { name: "Facturas" });
    expect(getTreasuryStatement).toHaveBeenCalledWith(expect.any(String), "s1", expect.any(AbortSignal));
    expect(screen.getByLabelText("Estado")).toHaveValue("open");
    expect(screen.getByLabelText("Estación")).toHaveValue("s1");
    expect(screen.getByLabelText("Número de factura")).toHaveValue("0003");
    expect(within(table).getAllByRole("row").filter(row => /E31/.test(row.textContent ?? ""))).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "Vencida" } });
    fireEvent.change(screen.getByLabelText("Emitidas desde"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(window.location.search)
      .toBe("?ref=correo&estado=vencidas&desde=2026-10-01&estacion=s1&buscar=0003"));
    expect(window.location.pathname).toBe("/portal/finanzas");
    expect(window.location.hash).toBe("#tabla");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => expect(window.location.search).toBe("?ref=correo"));
  } finally {
    bootstrap.stations = [];
  }
});

it("ignores a filter of the address it does not understand", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice()]));
  window.history.replaceState(null, "", "/portal/finanzas?estado=raro&desde=no-es-fecha");
  render(<AirlineFinancePage airlineName="Demo Airlines" />);
  expect(await screen.findByRole("link", { name: "E310000000001" })).toBeInTheDocument();
  expect(screen.getByLabelText("Estado")).toHaveValue("");
  expect(screen.getByLabelText("Emitidas desde")).toHaveValue("");
  await waitFor(() => expect(window.location.search).toBe(""));
});

it("offers to drop the station of a shared address when its invoices cannot be read", async () => {
  getTreasuryStatement.mockImplementation(async (_asOf, stationId) => {
    if (stationId) throw Object.assign(new Error("forbidden"), { status: 403 });
    return statement([invoice()]);
  });
  window.history.replaceState(null, "", "/portal/finanzas?estacion=otra");
  render(<AirlineFinancePage airlineName="Demo Airlines" />);
  fireEvent.click(await screen.findByRole("button", { name: "Limpiar filtros" }));
  expect(await screen.findByRole("link", { name: "E310000000001" })).toBeInTheDocument();
  await waitFor(() => expect(window.location.search).toBe(""));
});

it("agrees the invoice count in the singular: never «de 1 facturas»", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice({ applied: 0, credited: 0, balance: 118 })]));
  render(<AirlineFinancePage airlineName="Demo Airlines" />);
  const summary = await screen.findByLabelText("Resumen de facturas");
  expect(within(summary).getByText("Facturas con saldo").parentElement).toHaveTextContent("1 de 1factura pendiente de pago");
  expect(screen.getByText("1 factura emitida.")).toBeInTheDocument();
  expect(document.body).not.toHaveTextContent(/1 facturas|de 1 facturas/);
});
