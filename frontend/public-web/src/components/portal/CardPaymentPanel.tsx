"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CardPaymentAttemptResponse, CardPaymentAvailabilityResponse, CardPaymentListResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { BILLING_PROBLEMS, cardPaymentProblem } from "@/lib/billing-problems";
import { downloadFile } from "@/lib/download-file";
import { formatDateTime, formatMoney } from "@/lib/portal-format";
import { CARD_EXPIRY_ERRORS, CARD_EXPIRY_HINT, formatCardExpiry, parseCardExpiry } from "@/lib/card-expiry";
import styles from "./AirlinePortalPage.module.css";
import { ActionGroup, Button, DataTable, StatusBadge, type BadgeTone, type ButtonVariant } from "./PortalUi";
import { useLiveSnapshot } from "./useLiveSnapshot";

const DECLINES: Record<string, string> = {
  insufficient_funds: "Tarjeta rechazada: fondos insuficientes.",
  expired_card: "Tarjeta rechazada: el banco la reporta vencida.",
  card_not_accepted: "Tarjeta rechazada: no fue aceptada.",
  processing_error: "Error del procesador de pagos. Puede reintentar.",
};
/** 4-N05: the gateway of the simulation is labelled as such next to the card form. */
export const CARD_SIMULATION_LABEL = "Simulación — sin validez fiscal";

const money = (value: number, currency: string) => formatMoney(currency, value);
const save = downloadFile;

/** 4-N30: the receipt of an approved attempt, with «Preparando recibo…» and a recoverable error like the invoice PDF. */
function ReceiptButton({ attempt, variant = "secondary" }: {
  attempt: Pick<CardPaymentAttemptResponse, "id" | "authorizationCode">; variant?: ButtonVariant;
}) {
  const { getCardPaymentReceipt } = useAirlineSession();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  return <>
    <Button variant={variant} disabled={state === "loading"} onClick={() => {
      setState("loading");
      void getCardPaymentReceipt(attempt.id).then(blob => save(blob, `recibo-${attempt.authorizationCode}.pdf`))
        .then(() => setState("idle"), () => setState("error"));
    }}>{state === "loading" ? "Preparando recibo…" : "Descargar recibo"}</Button>
    {state === "error" && <p role="alert" className={styles.fieldError}>No se pudo descargar el recibo. Inténtelo de nuevo.</p>}
  </>;
}

const ATTEMPT: Record<string, { text: string; tone: BadgeTone }> = {
  Approved: { text: "Aprobado", tone: "success" }, Declined: { text: "Rechazado", tone: "danger" },
  Error: { text: "Error del procesador", tone: "warning" },
};

type Outcome = { kind: "approved" | "declined" | "error" | "uncertain" | "rejected"; text: string; attempt?: CardPaymentAttemptResponse };

type Availability = { status: "loading" | "error" } | { status: "ready"; value: CardPaymentAvailabilityResponse };

/**
 * ADR-0036: pays the whole balance with a simulated card and shows every attempt with its receipt. 4-N05: the form is
 * offered only when the environment has a card gateway; the simulated one is labelled «Simulación — sin validez fiscal».
 */
export function CardPaymentPanel({ invoiceId, balance, currencyCode, onChanged }: {
  invoiceId: string; balance: number; currencyCode: string; onChanged: () => void;
}) {
  const { payInvoiceByCard, getInvoiceCardPayments, getCardPaymentAvailability, financeRevision } = useAirlineSession();
  const [availability, setAvailability] = useState<Availability>({ status: "loading" });
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [expiryError, setExpiryError] = useState<string | null>(null);
  const expiryField = useRef<HTMLInputElement>(null);
  const expiryId = useId();
  const [cvv, setCvv] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // A payment of this panel reads the history again, like a live change does.
  const [paid, setPaid] = useState(0);
  const pending = useRef<{ key: string } | null>(null);
  const readAttempts = useCallback((): Promise<CardPaymentListResponse> => getInvoiceCardPayments(invoiceId),
    [getInvoiceCardPayments, invoiceId]);
  // 4-N25: the attempts and their receipts stay on screen while the history is read again.
  const history = useLiveSnapshot(invoiceId, `${financeRevision}|${paid}`, readAttempts);

  useEffect(() => {
    let active = true;
    void getCardPaymentAvailability()
      .then(value => { if (active) setAvailability({ status: "ready", value }); })
      .catch(() => { if (active) setAvailability({ status: "error" }); });
    return () => { active = false; };
  }, [availabilityRetry, getCardPaymentAvailability]);

  const submit = useCallback(async () => {
    // S4: an expiry the API would refuse is not sent; the last answer of the server goes and the field says why.
    const card = parseCardExpiry(expiry);
    if (!card.ok) {
      setOutcome(null);
      setExpiryError(CARD_EXPIRY_ERRORS[card.reason]);
      expiryField.current?.focus();
      return;
    }
    // An uncertain result is retried with the same key and body; any answered attempt gets a new key.
    const key = pending.current?.key ?? crypto.randomUUID();
    pending.current = { key };
    setBusy(true);
    setOutcome(null);
    try {
      const result = await payInvoiceByCard(invoiceId, { cardholderName: holder, cardNumber: number,
        expiryMonth: card.month, expiryYear: card.year, securityCode: cvv, amount: balance }, key);
      pending.current = null;
      const attempt = result.attempt;
      if (attempt.status === "Approved") {
        setOutcome({ kind: "approved", attempt,
          text: `Pago aprobado · ${attempt.brand} terminada en ${attempt.last4} · autorización ${attempt.authorizationCode}.` });
        setNumber(""); setCvv(""); setOpen(false);
      } else {
        setOutcome({ kind: attempt.status === "Error" ? "error" : "declined", attempt,
          text: DECLINES[attempt.declineCode ?? ""] ?? "La tarjeta no fue aprobada." });
        setCvv("");
      }
      setPaid(value => value + 1);
      onChanged();
    } catch (error) {
      const problem = cardPaymentProblem(error);
      // An answer of the server settles the intent; an uncertain one is retried with the same key and body.
      if (!problem.uncertain) pending.current = null;
      setOutcome({ kind: problem.uncertain ? "uncertain" : "rejected", text: problem.text });
      if (problem.code === "card_payments_unavailable") {
        setAvailability({ status: "ready", value: { available: false, simulated: false } });
        setOpen(false);
      }
      if (problem.refresh) onChanged();
    } finally {
      setBusy(false);
    }
  }, [balance, cvv, expiry, holder, invoiceId, number, onChanged, payInvoiceByCard]);

  const items = history.data?.attempts ?? null;
  const payable = availability.status === "ready" && availability.value.available;
  const simulated = availability.status === "ready" && availability.value.simulated;
  const tone = outcome?.kind === "approved" ? "success" : outcome ? "danger" : undefined;
  return <section className={styles.paymentCard} aria-label="Pago con tarjeta">
    <h2>Pago con tarjeta</h2>
    {balance > 0 ? <p className={styles.note}>Saldo a pagar: <strong>{money(balance, currencyCode)}</strong></p>
      : <p className={styles.note}>Esta factura no tiene saldo pendiente.</p>}
    {outcome && <div role={outcome.kind === "approved" ? "status" : "alert"} className={styles.notice} data-tone={tone}>
      <p>{outcome.text}</p>
      {outcome.kind === "approved" && outcome.attempt && <ActionGroup><ReceiptButton attempt={outcome.attempt} /></ActionGroup>}
    </div>}
    {balance > 0 && availability.status === "loading" && <p role="status">Consultando el pago con tarjeta…</p>}
    {balance > 0 && availability.status === "error" && <div role="alert" className={styles.notice} data-tone="danger">
      <p>No se pudo consultar si el pago con tarjeta está disponible.</p>
      <ActionGroup><Button onClick={() => { setAvailability({ status: "loading" });
        setAvailabilityRetry(value => value + 1); }}>Reintentar</Button></ActionGroup>
    </div>}
    {balance > 0 && availability.status === "ready" && !availability.value.available && outcome?.text !== BILLING_PROBLEMS.card_payments_unavailable &&
      <p className={styles.note}>{BILLING_PROBLEMS.card_payments_unavailable}</p>}
    {balance > 0 && payable && !open && <ActionGroup>
      <Button variant="primary" onClick={() => { setOpen(true); setOutcome(null); }}>
        Pagar con tarjeta {money(balance, currencyCode)}</Button></ActionGroup>}
    {balance > 0 && payable && open && <form className={styles.paymentForm} aria-label="Datos de la tarjeta"
      onSubmit={event => { event.preventDefault(); void submit(); }}>
      {simulated && <p className={styles.notice}><strong>{CARD_SIMULATION_LABEL}</strong></p>}
      <p className={styles.note}>Se paga el saldo completo: <strong>{money(balance, currencyCode)}</strong>.{simulated ? " Pago simulado: no se mueve dinero real." : ""}</p>
      <label>Titular de la tarjeta<input required autoComplete="cc-name" maxLength={80} value={holder}
        onChange={event => setHolder(event.target.value)} /></label>
      <label>Número de tarjeta<input required inputMode="numeric" autoComplete="cc-number" maxLength={23} value={number}
        onChange={event => { setNumber(event.target.value.replace(/[^\d ]/g, "")); pending.current = null; }} /></label>
      {/* S4: the input sits outside its label, so the browser's own message (formValidation.ts) never joins its name. */}
      <div className={styles.cardField}>
        <label htmlFor={expiryId}>Vencimiento (MM/AA)</label>
        <input id={expiryId} ref={expiryField} required inputMode="numeric" autoComplete="cc-exp" placeholder="MM/AA"
          maxLength={10} value={expiry} aria-invalid={expiryError ? true : undefined} aria-describedby={`${expiryId}-hint`}
          onChange={event => { setExpiry(formatCardExpiry(event.target.value, expiry)); setExpiryError(null);
            pending.current = null; }} />
        {/* Always mounted and live: Enter inside the field submits without moving the focus, and the error is still heard. */}
        <p id={`${expiryId}-hint`} className={expiryError ? styles.fieldError : styles.fieldHint} aria-live="polite">
          {expiryError ?? CARD_EXPIRY_HINT}</p>
      </div>
      <label>Código de seguridad<input required type="password" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={cvv}
        onChange={event => { setCvv(event.target.value.replace(/\D/g, "")); pending.current = null; }} /></label>
      <ActionGroup>
        <Button disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Procesando pago…" : `Pagar ${money(balance, currencyCode)}`}</Button>
      </ActionGroup>
    </form>}
    <h3>Intentos de pago con tarjeta</h3>
    {history.failed && <div role="alert" className={styles.notice} data-tone="danger">
      <p>{items ? "No se pudo actualizar el historial de pagos con tarjeta. Mostramos los últimos datos."
        : "No se pudo consultar el historial de pagos con tarjeta."}</p>
      <ActionGroup><Button onClick={history.retry}>Reintentar</Button></ActionGroup></div>}
    {!items && !history.failed && <p role="status">Cargando pagos con tarjeta…</p>}
    {items && <DataTable<CardPaymentAttemptResponse> caption="Intentos de pago con tarjeta" rows={items} rowKey={item => item.id}
      empty="Sin pagos con tarjeta." columns={[
        { key: "card", header: "Intento", nowrap: true, cell: item => <span className={styles.cellStack}>
          <span>{item.brand} •••• {item.last4}</span>
          <span>{money(item.amount, item.currencyCode)}</span>
          <span className={styles.subtle}>{formatDateTime(item.attemptedAt)}</span></span> },
        { key: "status", header: "Estado", minWidth: "9rem", cell: item => <span className={styles.cellStack}>
          <StatusBadge tone={(ATTEMPT[item.status] ?? ATTEMPT.Error).tone}>{(ATTEMPT[item.status] ?? ATTEMPT.Error).text}</StatusBadge>
          {item.authorizationCode && <span className={styles.subtle}>Autorización {item.authorizationCode}</span>}
          {item.declineCode && <span className={styles.subtle}>{DECLINES[item.declineCode] ?? item.declineCode}</span>}
          {item.status === "Approved" && <span><ReceiptButton attempt={item} variant="ghost" /></span>}</span> },
      ]} />}
  </section>;
}