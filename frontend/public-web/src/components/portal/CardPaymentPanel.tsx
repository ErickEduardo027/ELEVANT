"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ElevantApiError, type CardPaymentAttemptResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import styles from "./AirlinePortalPage.module.css";

const DECLINES: Record<string, string> = {
  insufficient_funds: "Tarjeta rechazada: fondos insuficientes.",
  expired_card: "Tarjeta rechazada: el banco la reporta vencida.",
  card_not_accepted: "Tarjeta rechazada: no fue aceptada.",
  processing_error: "Error del procesador de pagos. Puedes reintentar.",
};
const REASONS: Record<string, string> = {
  cardholder_invalid: "Escribe el nombre del titular.",
  card_number_invalid: "El número de tarjeta no es válido.",
  card_expired: "La fecha de vencimiento ya pasó.",
  security_code_invalid: "El código de seguridad no es válido.",
  amount_mismatch: "El saldo cambió. Actualizamos la factura: revisa el monto.",
  invoice_paid: "Esta factura ya está pagada.",
  idempotency_conflict: "El intento cambió. Vuelve a enviar el pago.",
};

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

type Outcome = { kind: "approved" | "declined" | "error" | "uncertain" | "rejected"; text: string; attempt?: CardPaymentAttemptResponse };

/** ADR-0036: pays the whole balance with a simulated card and shows every attempt with its receipt. */
export function CardPaymentPanel({ invoiceId, balance, currencyCode, onChanged }: {
  invoiceId: string; balance: number; currencyCode: string; onChanged: () => void;
}) {
  const { payInvoiceByCard, getInvoiceCardPayments, getCardPaymentReceipt, financeRevision } = useAirlineSession();
  const [open, setOpen] = useState(false);
  const [holder, setHolder] = useState("");
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [attempts, setAttempts] = useState<{ key: string; items: CardPaymentAttemptResponse[] | null; error: boolean }>(
    { key: "", items: null, error: false });
  const [retry, setRetry] = useState(0);
  const pending = useRef<{ key: string } | null>(null);
  const listKey = `${invoiceId}|${financeRevision}|${retry}`;

  useEffect(() => {
    let active = true;
    void getInvoiceCardPayments(invoiceId)
      .then(list => { if (active) setAttempts({ key: listKey, items: list.attempts, error: false }); })
      .catch(() => { if (active) setAttempts({ key: listKey, items: null, error: true }); });
    return () => { active = false; };
  }, [getInvoiceCardPayments, invoiceId, listKey]);

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
      setRetry(value => value + 1);
      onChanged();
    } catch (error) {
      if (error instanceof ElevantApiError && error.status > 0 && error.status < 500) {
        pending.current = null;
        const reason = error.reasons[0];
        setOutcome({ kind: "rejected", text: (reason && REASONS[reason]) ?? "No se pudo procesar el pago." });
        if (reason === "amount_mismatch" || reason === "invoice_paid") onChanged();
      } else {
        setOutcome({ kind: "uncertain", text: "No se pudo confirmar el pago. Reintenta: no se cobrará dos veces." });
      }
    } finally {
      setBusy(false);
    }
  }, [balance, cvv, expiry, holder, invoiceId, number, onChanged, payInvoiceByCard]);

  const items = attempts.key === listKey ? attempts.items : null;
  return <section className={styles.preinvoiceLines} aria-label="Pago con tarjeta">
    <h3>Pago con tarjeta</h3>
    {outcome && <p role={outcome.kind === "approved" ? "status" : "alert"}>{outcome.text}</p>}
    {outcome?.kind === "approved" && outcome.attempt && <button type="button" className={styles.loadMore}
      onClick={() => void getCardPaymentReceipt(outcome.attempt!.id).then(blob => save(blob, `recibo-${outcome.attempt!.authorizationCode}.pdf`))}>
      Descargar recibo</button>}
    {balance > 0 && !open && <button type="button" className={styles.loadMore} onClick={() => { setOpen(true); setOutcome(null); }}>
      Pagar con tarjeta {money(balance, currencyCode)}</button>}
    {balance > 0 && open && <form className={styles.disputeForm} aria-label="Datos de la tarjeta"
      onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p>Se paga el saldo completo: <strong>{money(balance, currencyCode)}</strong>. Pago simulado: no se mueve dinero real.</p>
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
    {attempts.error && <p role="alert">No se pudo consultar el historial de pagos con tarjeta.
      <button type="button" className={styles.loadMore} onClick={() => setRetry(value => value + 1)}>Reintentar</button></p>}
    {items && items.length === 0 && <p>Sin pagos con tarjeta.</p>}
    {items?.map(item => <article key={item.id} className={styles.disputeRecord} aria-label={`Intento ${item.brand} ${item.last4}`}>
      <strong>{item.status === "Approved" ? "Aprobado" : item.status === "Declined" ? "Rechazado" : "Error del procesador"} · {item.brand} •••• {item.last4} · {money(item.amount, item.currencyCode)}</strong>
      <p>{new Date(item.attemptedAt).toLocaleString("es-DO")}{item.authorizationCode ? ` · autorización ${item.authorizationCode}` : ""}
        {item.declineCode ? ` · ${DECLINES[item.declineCode] ?? item.declineCode}` : ""}</p>
      {item.status === "Approved" && <button type="button" className={styles.loadMore}
        onClick={() => void getCardPaymentReceipt(item.id).then(blob => save(blob, `recibo-${item.authorizationCode}.pdf`))}>
        Descargar recibo</button>}
    </article>)}
  </section>;
}
