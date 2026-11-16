import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ElevantApiError } from "@elevant/api-client";

import { CARD_SIMULATION_LABEL, CardPaymentPanel } from "@/components/portal/CardPaymentPanel";

type Availability = { available: boolean; simulated: boolean };
const getCardPaymentAvailability = vi.fn<() => Promise<Availability>>(async () => ({ available: true, simulated: true }));
const payInvoiceByCard = vi.fn<(invoiceId: string, body: Record<string, unknown>, key: string) => Promise<unknown>>(
  async () => { throw new Error("not mocked"); });
const getInvoiceCardPayments = vi.fn(async (invoiceId: string) => ({ invoiceId, attempts: [] as unknown[] }));
let financeRevision = 0;
const getCardPaymentReceipt = vi.fn<(attemptId: string) => Promise<Blob>>(
  async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }));

vi.mock("@/components/auth/AirlineSessionProvider", () => ({
  useAirlineSession: () => ({ payInvoiceByCard, getInvoiceCardPayments, getCardPaymentReceipt, getCardPaymentAvailability,
    financeRevision }),
}));

const invoiceId = "74000000-0000-7000-8000-000000000009";
const onChanged = vi.fn();

afterEach(() => {
  cleanup();
  getCardPaymentAvailability.mockReset();
  getCardPaymentAvailability.mockImplementation(async () => ({ available: true, simulated: true }));
  payInvoiceByCard.mockReset();
  getInvoiceCardPayments.mockClear();
  getCardPaymentReceipt.mockReset();
  onChanged.mockReset();
  financeRevision = 0;
});

function mount(balance = 148.09) {
  return render(<CardPaymentPanel invoiceId={invoiceId} balance={balance} currencyCode="USD" onChanged={onChanged} />);
}

function fill(form: HTMLElement) {
  fireEvent.change(within(form).getByLabelText("Titular de la tarjeta"), { target: { value: "Casey Airline" } });
  fireEvent.change(within(form).getByLabelText("Número de tarjeta"), { target: { value: "4111 1111 1111 1111" } });
  fireEvent.change(within(form).getByLabelText("Vencimiento (MM/AA)"), { target: { value: "12/30" } });
  fireEvent.change(within(form).getByLabelText("Código de seguridad"), { target: { value: "123" } });
}

it("labels the simulated gateway next to the card form (4-N05)", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" }));
  const form = screen.getByRole("form", { name: "Datos de la tarjeta" });
  expect(within(form).getByText(CARD_SIMULATION_LABEL)).toBeInTheDocument();
  expect(CARD_SIMULATION_LABEL).toBe("Simulación — sin validez fiscal");
});

it("offers no card form without a gateway and explains how to pay (4-N05)", async () => {
  getCardPaymentAvailability.mockResolvedValue({ available: false, simulated: false });
  mount();
  expect(await screen.findByText(/El pago con tarjeta no está disponible en este momento/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Pagar con tarjeta/ })).not.toBeInTheDocument();
  expect(screen.queryByText(CARD_SIMULATION_LABEL)).not.toBeInTheDocument();
});

it("retries the availability after a failed read (4-N05)", async () => {
  getCardPaymentAvailability.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  mount();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("No se pudo consultar si el pago con tarjeta está disponible.");
  fireEvent.click(within(alert).getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" })).toBeInTheDocument();
  expect(getCardPaymentAvailability).toHaveBeenCalledTimes(2);
});

it("closes the form when the server answers card_payments_unavailable (4-N05)", async () => {
  payInvoiceByCard.mockRejectedValueOnce(new ElevantApiError({ kind: "http", status: 409, code: "card_payments_unavailable",
    reasons: ["card_payments_unavailable"] }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" }));
  const form = screen.getByRole("form", { name: "Datos de la tarjeta" });
  fill(form);
  fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("El pago con tarjeta no está disponible en este momento");
  expect(screen.queryByRole("form", { name: "Datos de la tarjeta" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Pagar con tarjeta/ })).not.toBeInTheDocument();
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

it("names an invoice without balance as such, credited or paid (4-N24)", async () => {
  payInvoiceByCard.mockRejectedValueOnce(new ElevantApiError({ kind: "http", status: 409, code: "invoice_paid",
    reasons: ["invoice_paid"] }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" }));
  const form = screen.getByRole("form", { name: "Datos de la tarjeta" });
  fill(form);
  fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Esta factura no tiene saldo pendiente.");
});

const approved = { id: "75000000-0000-7000-8000-000000000001", invoiceId, status: "Approved", brand: "Visa", last4: "1111",
  amount: 148.09, currencyCode: "USD", authorizationCode: "ABC234", declineCode: null, receiptId: "75000000-0000-7000-8000-000000000002",
  attemptedAt: "2026-11-05T12:00:00Z" };

it("keeps the card attempts on screen while the history is read again (4-N25)", async () => {
  getInvoiceCardPayments.mockResolvedValueOnce({ invoiceId, attempts: [approved] });
  const view = mount(0);
  expect(await screen.findByText(/Aprobado · Visa •••• 1111/)).toBeInTheDocument();
  let fail!: (error: unknown) => void;
  getInvoiceCardPayments.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  financeRevision += 1;
  view.rerender(<CardPaymentPanel invoiceId={invoiceId} balance={0} currencyCode="USD" onChanged={onChanged} />);
  await waitFor(() => expect(getInvoiceCardPayments).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Aprobado · Visa •••• 1111/)).toBeInTheDocument();
  expect(screen.queryByText("Cargando pagos con tarjeta…")).not.toBeInTheDocument();
  await act(async () => fail(new TypeError("Failed to fetch")));
  expect(screen.getByRole("alert")).toHaveTextContent("No se pudo actualizar el historial de pagos con tarjeta. Mostramos los últimos datos.");
  expect(screen.getByRole("button", { name: "Descargar recibo" })).toBeInTheDocument();
});

it("explains a failed receipt download and lets it be tried again (4-N30)", async () => {
  getInvoiceCardPayments.mockResolvedValueOnce({ invoiceId, attempts: [approved] });
  getCardPaymentReceipt.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  mount(0);
  fireEvent.click(await screen.findByRole("button", { name: "Descargar recibo" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo descargar el recibo. Inténtalo de nuevo.");
  expect(getCardPaymentReceipt).toHaveBeenCalledWith(approved.id);
  const createObjectURL = vi.fn(() => "blob:receipt");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  getCardPaymentReceipt.mockResolvedValueOnce(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Descargar recibo" }));
  await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
