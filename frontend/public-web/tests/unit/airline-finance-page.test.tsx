import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { AirlineFinancePage } from "@/components/portal/AirlineFinancePage";
import type { AirlineTreasuryInvoice, AirlineTreasuryInvoiceDetail, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";

const actor = { accountId: "40000000-0000-7000-8000-000000000003" };
const bootstrap = { stations: [] };
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
  financeRevision = 0;
  getTreasuryStatement.mockReset();
  getTreasuryInvoice.mockReset();
  getAdjustmentNoteDocument.mockReset();
});

it("keeps the invoices on screen while they are read again and after a failed read (4-N25)", async () => {
  getTreasuryStatement.mockResolvedValueOnce(statement([invoice()]));
  const page = render(<AirlineFinancePage airlineName="Demo Airlines" />);
  expect(await screen.findByRole("heading", { level: 2, name: "Factura E310000000001" })).toBeInTheDocument();

  let fail!: (error: unknown) => void;
  getTreasuryStatement.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  financeRevision += 1;
  page.rerender(<AirlineFinancePage airlineName="Demo Airlines" />);
  expect(await screen.findByRole("status")).toHaveTextContent("Actualizando…");
  expect(screen.getByRole("heading", { level: 2, name: "Factura E310000000001" })).toBeInTheDocument();
  expect(screen.queryByText("Cargando facturas autorizadas…")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Descargar PDF de Factura E310000000001" })).toBeInTheDocument();

  await act(async () => fail(new TypeError("Failed to fetch")));
  const alert = screen.getByRole("alert");
  expect(alert).toHaveTextContent("No se pudo actualizar. Mostramos los últimos datos.");
  expect(screen.getByRole("heading", { level: 2, name: "Factura E310000000001" })).toBeInTheDocument();
  expect(screen.queryByText("No se pudieron consultar las facturas.")).not.toBeInTheDocument();

  getTreasuryStatement.mockResolvedValueOnce(statement([invoice(), invoice({ id: "74000000-0000-7000-8000-000000000019",
    fiscalNumber: "E310000000002", balance: 50, applied: 0, credited: 0 })]));
  fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Factura E310000000002" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("shows the airline's credit in its favour and mounts the statement in the same page (4-N30)", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice()], [usd]));
  render(<AirlineFinancePage airlineName="Demo Airlines" />);
  const summary = await screen.findByLabelText("Resumen de facturas");
  // The credit note beyond what was paid (18) and the receipt not applied yet (800).
  expect(within(summary).getByText("Saldo a favor").nextSibling).toHaveTextContent("USD 818.00");
  expect(screen.getByRole("region", { name: "Factura E310000000001" })).toHaveTextContent("Pagada");

  const statementButton = screen.getByRole("button", { name: "Estado de cuenta" });
  expect(statementButton).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(statementButton);
  expect(statementButton).toHaveAttribute("aria-pressed", "true");
  const panel = await screen.findByRole("region", { name: "Estado de cuenta de aerolínea" });
  expect(await within(panel).findByText("Crédito a favor")).toBeInTheDocument();
  expect(within(panel).getByText("Cobros sin aplicar")).toBeInTheDocument();
  expect(within(panel).getByText("Factura E310000000001 · PUJ")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Facturas" }));
  expect(await screen.findByLabelText("Resumen de facturas")).toBeInTheDocument();
});

it("lists the invoice's credit notes by their e-NCF with a PDF that recovers from a failed download (4-N17)", async () => {
  getTreasuryStatement.mockResolvedValue(statement([invoice()]));
  getTreasuryInvoice.mockResolvedValue({ invoice: invoice(), lines: [], movements: [
    { id: "m-1", receiptId: null, invoiceId: invoice().id, kind: "Credit", currencyCode: "USD", amount: 18,
      effectiveOn: "2026-11-09", recordedAt: "2026-11-09T15:00:00Z", reversesId: null, reference: "E340000000001" }],
  notes: [{ id: "75000000-0000-7000-8000-000000000001", number: "E340000000001", invoiceId: invoice().id, relatedNoteId: null,
    kind: "Credit", currencyCode: "USD", amount: 18, effectiveOn: "2026-11-09", reason: "Servicio no prestado completo",
    recordedAt: "2026-11-09T15:00:00Z", lines: [] }] });
  render(<AirlineFinancePage airlineName="Demo Airlines" />);
  fireEvent.click(await screen.findByRole("button", { name: "Ver detalle" }));
  const notes = await screen.findByRole("region", { name: "Notas de crédito y débito" });
  expect(within(notes).getByText(/Nota de crédito electrónica E340000000001 · USD 18.00/)).toBeInTheDocument();
  // The note is listed with its PDF, not as a payment.
  expect(screen.getByRole("region", { name: "Pagos de la factura" })).toHaveTextContent("Sin pagos registrados.");

  getAdjustmentNoteDocument.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const button = within(notes).getByRole("button", { name: "Descargar PDF de Nota de crédito electrónica E340000000001" });
  fireEvent.click(button);
  expect(await within(notes).findByRole("alert")).toHaveTextContent("No se pudo descargar el PDF de la nota. Inténtalo de nuevo.");
  expect(within(notes).getByText(/E340000000001/)).toBeInTheDocument();

  const createObjectURL = vi.fn(() => "blob:note");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  getAdjustmentNoteDocument.mockResolvedValueOnce(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
  fireEvent.click(button);
  await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  expect(getAdjustmentNoteDocument).toHaveBeenLastCalledWith("75000000-0000-7000-8000-000000000001");
  await waitFor(() => expect(within(notes).queryByRole("alert")).not.toBeInTheDocument());
});
