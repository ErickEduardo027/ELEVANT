import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ElevantApiError } from "@elevant/api-client";

import { CARD_SIMULATION_LABEL, CardPaymentPanel } from "@/components/portal/CardPaymentPanel";
import { CARD_EXPIRY_ERRORS, CARD_EXPIRY_HINT } from "@/lib/card-expiry";
import { installFormValidation } from "@/lib/forms/formValidation";

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
  vi.useRealTimers();
});

function mount(balance = 148.09) {
  return render(<CardPaymentPanel invoiceId={invoiceId} balance={balance} currencyCode="USD" onChanged={onChanged} />);
}

/** Fills the card form; an empty `expiry` leaves that field as it is. */
function fill(form: HTMLElement, expiry = "12/40") {
  fireEvent.change(within(form).getByLabelText("Titular de la tarjeta"), { target: { value: "Casey Airline" } });
  fireEvent.change(within(form).getByLabelText("Número de tarjeta"), { target: { value: "4111 1111 1111 1111" } });
  if (expiry) fireEvent.change(within(form).getByLabelText("Vencimiento (MM/AA)"), { target: { value: expiry } });
  fireEvent.change(within(form).getByLabelText("Código de seguridad"), { target: { value: "123" } });
}

async function openForm() {
  fireEvent.click(await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" }));
  return screen.getByRole("form", { name: "Datos de la tarjeta" });
}

const pay = (form: HTMLElement) => fireEvent.click(within(form).getByRole("button", { name: "Pagar USD 148.09" }));

it("labels the simulated gateway next to the card form (4-N05)", async () => {
  mount();
  const open = await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" });
  expect(open).toHaveAttribute("data-variant", "primary");
  fireEvent.click(open);
  const form = screen.getByRole("form", { name: "Datos de la tarjeta" });
  expect(within(form).getByText(CARD_SIMULATION_LABEL)).toBeInTheDocument();
  // «Pagar USD x» is the form's primary action and «Cancelar» its secondary one, grouped after the fields.
  const actions = within(form).getAllByRole("button");
  expect(actions.map(button => [button.textContent, button.dataset.variant])).toEqual([
    ["Cancelar", "secondary"], ["Pagar USD 148.09", "primary"]]);
  fireEvent.click(within(form).getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("form", { name: "Datos de la tarjeta" })).not.toBeInTheDocument();
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
  const row = await screen.findByRole("row", { name: /Visa •••• 1111/ });
  expect(row).toHaveTextContent(/Aprobado.*Autorización ABC234/);
  expect(row).toHaveTextContent("USD 148.09");
  let fail!: (error: unknown) => void;
  getInvoiceCardPayments.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  financeRevision += 1;
  view.rerender(<CardPaymentPanel invoiceId={invoiceId} balance={0} currencyCode="USD" onChanged={onChanged} />);
  await waitFor(() => expect(getInvoiceCardPayments).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("row", { name: /Visa •••• 1111/ })).toHaveTextContent("Aprobado");
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
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo descargar el recibo. Inténtelo de nuevo.");
  expect(getCardPaymentReceipt).toHaveBeenCalledWith(approved.id);
  const createObjectURL = vi.fn(() => "blob:receipt");
  Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
  getCardPaymentReceipt.mockResolvedValueOnce(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
  fireEvent.click(screen.getByRole("button", { name: "Descargar recibo" }));
  await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

// S4: the fake clock only mocks Date, so the expiry is checked against a fixed business day.
const NOV_19 = new Date("2026-11-19T12:00:00Z");
const declined = { ...approved, status: "Declined", authorizationCode: null, declineCode: "insufficient_funds", receiptId: null };
const expiryOf = (form: HTMLElement) => within(form).getByLabelText("Vencimiento (MM/AA)");

it.each(["1230", "12 30", "12-30", "122030", "12/2030"])("pays with the expiry %j, with or without the slash (S4)", async expiry => {
  vi.setSystemTime(NOV_19);
  payInvoiceByCard.mockResolvedValueOnce({ attempt: approved, invoiceBalance: 0, replayed: false });
  mount();
  const form = await openForm();
  fill(form, expiry);
  pay(form);
  expect(await screen.findByText(/Pago aprobado · Visa terminada en 1111/)).toBeInTheDocument();
  expect(payInvoiceByCard).toHaveBeenCalledTimes(1);
  expect(payInvoiceByCard.mock.calls[0][1]).toMatchObject({ expiryMonth: 12, expiryYear: 2030 });
});

it("does not call the API with the month 13: the field says why and the last answer goes (S4)", async () => {
  vi.setSystemTime(NOV_19);
  payInvoiceByCard.mockResolvedValueOnce({ attempt: declined, invoiceBalance: 148.09, replayed: false });
  mount();
  const form = await openForm();
  fill(form);
  const field = expiryOf(form);
  expect(field).toHaveAccessibleDescription(CARD_EXPIRY_HINT);
  pay(form);
  expect(await screen.findByRole("alert")).toHaveTextContent("Tarjeta rechazada: fondos insuficientes.");
  fireEvent.change(field, { target: { value: "13/30" } });
  // The security code is cleared after a declined card.
  fireEvent.change(within(form).getByLabelText("Código de seguridad"), { target: { value: "123" } });
  pay(form);
  expect(payInvoiceByCard).toHaveBeenCalledTimes(1);
  expect(field).toHaveFocus();
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription(CARD_EXPIRY_ERRORS.month);
  expect(screen.queryByText("Tarjeta rechazada: fondos insuficientes.")).not.toBeInTheDocument();
  // Editing the field takes the error away and shows the hint again.
  fireEvent.change(field, { target: { value: "12/30" } });
  expect(field).not.toHaveAttribute("aria-invalid");
  expect(field).toHaveAccessibleDescription(CARD_EXPIRY_HINT);
});

it("announces a refused expiry when the airline submits with Enter from the field itself (S4)", async () => {
  vi.setSystemTime(NOV_19);
  const user = userEvent.setup();
  mount();
  const form = await openForm();
  fill(form, "");
  const field = expiryOf(form);
  const liveAncestor = (text: string) => screen.getByText(text).closest('[aria-live="polite"], [role="alert"]');
  await user.click(field);
  await user.keyboard("1330{Enter}");
  expect(payInvoiceByCard).not.toHaveBeenCalled();
  // The focus is already in the field and does not move, so only a live region makes the error heard.
  expect(field).toHaveFocus();
  expect(liveAncestor(CARD_EXPIRY_ERRORS.month)).not.toBeNull();
  await user.clear(field);
  await user.keyboard("1026{Enter}");
  expect(payInvoiceByCard).not.toHaveBeenCalled();
  expect(field).toHaveFocus();
  expect(liveAncestor(CARD_EXPIRY_ERRORS.expired)).not.toBeNull();
});

it("says a processor error can be retried, addressing the airline as usted (N19)", async () => {
  payInvoiceByCard.mockResolvedValueOnce({ attempt: { ...declined, status: "Error", declineCode: "processing_error" },
    invoiceBalance: 148.09, replayed: false });
  mount();
  const form = await openForm();
  fill(form);
  pay(form);
  expect(await screen.findByRole("alert")).toHaveTextContent("Error del procesador de pagos. Puede reintentar.");
});

it("refuses an expired card before the API, by the fake clock (S4)", async () => {
  vi.setSystemTime(NOV_19);
  mount();
  const form = await openForm();
  fill(form, "10/26");
  pay(form);
  expect(payInvoiceByCard).not.toHaveBeenCalled();
  expect(expiryOf(form)).toHaveFocus();
  expect(expiryOf(form)).toHaveAccessibleDescription(CARD_EXPIRY_ERRORS.expired);
});

it("still pays with a card of 11/26 at 20:30 of 30 November in Santo Domingo, already 1 December in UTC (S4)", async () => {
  vi.setSystemTime(new Date("2026-12-01T00:30:00Z"));
  payInvoiceByCard.mockResolvedValueOnce({ attempt: approved, invoiceBalance: 0, replayed: false });
  mount();
  const form = await openForm();
  fill(form, "11/26");
  pay(form);
  expect(await screen.findByText(/Pago aprobado/)).toBeInTheDocument();
  expect(payInvoiceByCard.mock.calls[0][1]).toMatchObject({ expiryMonth: 11, expiryYear: 2026 });
});

it("refuses a card of 11/26 from 00:30 of 1 December in Santo Domingo (S4)", async () => {
  vi.setSystemTime(new Date("2026-12-01T04:30:00Z"));
  mount();
  const form = await openForm();
  fill(form, "11/26");
  pay(form);
  expect(payInvoiceByCard).not.toHaveBeenCalled();
  expect(expiryOf(form)).toHaveAccessibleDescription(CARD_EXPIRY_ERRORS.expired);
});

it("formats the expiry while it is typed, erased and pasted (S4)", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Pagar con tarjeta USD 148.09" }));
  const field = screen.getByLabelText("Vencimiento (MM/AA)");
  expect(field).toHaveAttribute("inputmode", "numeric");
  expect(field).toHaveAttribute("autocomplete", "cc-exp");
  expect(Number(field.getAttribute("maxlength"))).toBeGreaterThanOrEqual(10);
  await user.type(field, "12");
  expect(field).toHaveValue("12/");
  await user.keyboard("{Backspace}");
  expect(field).toHaveValue("12");
  await user.keyboard("40");
  expect(field).toHaveValue("12/40");
  await user.clear(field);
  await user.type(field, "1/2040");
  expect(field).toHaveValue("01/2040");
  await user.clear(field);
  await user.paste("12 / 2040");
  expect(field).toHaveValue("12/2040");
});

it("keeps the browser's own message for an empty expiry out of its label (S4)", async () => {
  const uninstall = installFormValidation(document);
  try {
    mount();
    const form = await openForm();
    fill(form, "");
    pay(form);
    const field = screen.getByLabelText("Vencimiento (MM/AA)");
    expect(field).toHaveAccessibleName("Vencimiento (MM/AA)");
    expect(field).toHaveAccessibleDescription(`${CARD_EXPIRY_HINT} Complete este campo.`);
    expect(field).toHaveFocus();
    expect(payInvoiceByCard).not.toHaveBeenCalled();
  } finally {
    uninstall();
  }
});
