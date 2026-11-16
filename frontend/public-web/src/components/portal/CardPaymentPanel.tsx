"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CardPaymentAttemptResponse, CardPaymentAvailabilityResponse, CardPaymentListResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { BILLING_PROBLEMS, cardPaymentProblem } from "@/lib/billing-problems";
import styles from "./AirlinePortalPage.module.css";
import { useLiveSnapshot } from "./useLiveSnapshot";

const DECLINES: Record<string, string> = {
  insufficient_funds: "Tarjeta rechazada: fondos insuficientes.",
  expired_card: "Tarjeta rechazada: el banco la reporta vencida.",
  card_not_accepted: "Tarjeta rechazada: no fue aceptada.",
  processing_error: "Error del procesador de pagos. Puedes reintentar.",
};
/** 4-N05: the gateway of the simulation is labelled as such next to the card form. */
export const CARD_SIMULATION_LABEL = "Simulación — sin validez fiscal";

const money = (value: number, currency: string) =>
  `${currency} ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** 4-N30: the receipt of an approved attempt, with «Preparando recibo…» and a recoverable error like the invoice PDF. */
function ReceiptButton({ attempt }: { attempt: Pick<CardPaymentAttemptResponse, "id" | "authorizationCode"> }) {
  const { getCardPaymentReceipt } = useAirlineSession();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  return <>
    <button type="button" className={styles.loadMore} disabled={state === "loading"} onClick={() => {
      setState("loading");
      void getCardPaymentReceipt(attempt.id).then(blob => save(blob, `recibo-${attempt.authorizationCode}.pdf`))
        .then(() => setState("idle"), () => setState("error"));
    }}>{state === "loading" ? "Preparando recibo…" : "Descargar recibo"}</button>
    {state === "error" && <p role="alert">No se pudo descargar el recibo. Inténtalo de nuevo.</p>}
  </>;
}

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
    const match = /^(\d{2})\s*\/\s*(\d{2}|\d{4})$/.exec(expiry.trim());
    if (!match) { setOutcome({ kind: "rejected", text: "Escribe el vencimiento como MM/AA." }); return; }
    const year = match[2].length === 2 ? 2000 + Number(match[2]) : Number(match[2]);
    // An uncertain result is retried with the same key and body; any answered attempt gets a new key.
    const key = pending.current?.key ?? crypto.randomUUID();
    pending.current = { key };
    setBusy(true);
    setOutcome(null);
    try {
      const result = await payInvoiceByCard(invoiceId, { cardholderName: holder, cardNumber: number,
        expiryMonth: Number(match[1]), expiryYear: year, securityCode: cvv, amount: balance }, key);
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
  return <section className={styles.preinvoiceLines} aria-label="Pago con tarjeta">
    <h3>Pago con tarjeta</h3>
    {outcome && <p role={outcome.kind === "approved" ? "status" : "alert"}>{outcome.text}</p>}
    {balance > 0 && availability.status === "loading" && <p role="status">Consultando el pago con tarjeta…</p>}
    {balance > 0 && availability.status === "error" && <div role="alert">
      <p>No se pudo consultar si el pago con tarjeta está disponible.</p>
      <button type="button" className={styles.loadMore} onClick={() => { setAvailability({ status: "loading" });
        setAvailabilityRetry(value => value + 1); }}>Reintentar</button>
    </div>}
    {balance > 0 && availability.status === "ready" && !availability.value.available && outcome?.text !== BILLING_PROBLEMS.card_payments_unavailable &&
      <p className={styles.note}>{BILLING_PROBLEMS.card_payments_unavailable}</p>}
    {outcome?.kind === "approved" && outcome.attempt && <ReceiptButton attempt={outcome.attempt} />}
    {balance > 0 && payable && !open && <button type="button" className={styles.loadMore} onClick={() => { setOpen(true); setOutcome(null); }}>
      Pagar con tarjeta {money(balance, currencyCode)}</button>}
    {balance > 0 && payable && open && <form className={styles.disputeForm} aria-label="Datos de la tarjeta"
      onSubmit={event => { event.preventDefault(); void submit(); }}>
      {simulated && <p className={styles.note}><strong>{CARD_SIMULATION_LABEL}</strong></p>}
      <p>Se paga el saldo completo: <strong>{money(balance, currencyCode)}</strong>.{simulated ? " Pago simulado: no se mueve dinero real." : ""}</p>
      <label>Titular de la tarjeta<input required autoComplete="cc-name" maxLength={80} value={holder}
        onChange={event => setHolder(event.target.value)} /></label>
      <label>Número de tarjeta<input required inputMode="numeric" autoComplete="cc-number" maxLength={23} value={number}
        onChange={event => { setNumber(event.target.value.replace(/[^\d ]/g, "")); pending.current = null; }} /></label>
      <label>Vencimiento (MM/AA)<input required autoComplete="cc-exp" placeholder="MM/AA" maxLength={7} value={expiry}
        onChange={event => { setExpiry(event.target.value); pending.current = null; }} /></label>
      <label>Código de seguridad<input required type="password" inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={cvv}
        onChange={event => { setCvv(event.target.value.replace(/\D/g, "")); pending.current = null; }} /></label>
      <button type="submit" className={styles.loadMore} disabled={busy}>{busy ? "Procesando pago…" : `Pagar ${money(balance, currencyCode)}`}</button>
      <button type="button" className={styles.loadMore} disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
    </form>}
    {history.failed && <p role="alert">{items ? "No se pudo actualizar el historial de pagos con tarjeta. Mostramos los últimos datos."
      : "No se pudo consultar el historial de pagos con tarjeta."}
      <button type="button" className={styles.loadMore} onClick={history.retry}>Reintentar</button></p>}
    {!items && !history.failed && <p role="status">Cargando pagos con tarjeta…</p>}
    {items && items.length === 0 && <p>Sin pagos con tarjeta.</p>}
    {items?.map(item => <article key={item.id} className={styles.disputeRecord} aria-label={`Intento ${item.brand} ${item.last4}`}>
      <strong>{item.status === "Approved" ? "Aprobado" : item.status === "Declined" ? "Rechazado" : "Error del procesador"} · {item.brand} •••• {item.last4} · {money(item.amount, item.currencyCode)}</strong>
      <p>{new Date(item.attemptedAt).toLocaleString("es-DO")}{item.authorizationCode ? ` · autorización ${item.authorizationCode}` : ""}
        {item.declineCode ? ` · ${DECLINES[item.declineCode] ?? item.declineCode}` : ""}</p>
      {item.status === "Approved" && <ReceiptButton attempt={item} />}
    </article>)}
  </section>;
}
