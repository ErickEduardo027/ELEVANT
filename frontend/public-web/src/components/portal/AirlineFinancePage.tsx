"use client";

import { useCallback, useState } from "react";
import { ElevantApiError } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import type { AirlineTreasuryInvoice, AirlineTreasuryInvoiceDetail, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import styles from "./AirlinePortalPage.module.css";
import { AirlineTreasuryPanel } from "./AirlineTreasuryPanel";
import { CardPaymentPanel } from "./CardPaymentPanel";
import { AdjustmentNotePdfButton, amount, InvoicePdfButton, invoiceStatus, invoiceTitle, noteTitle } from "./financeDocuments";
import { LiveSnapshotNotice } from "./LiveSnapshotNotice";
import { useLiveSnapshot } from "./useLiveSnapshot";
import { businessToday } from "@/lib/business-day";

export { amount, InvoicePdfButton, invoiceStatus, invoiceTitle, saveBlob } from "./financeDocuments";

// 4-N10: the cutoff is the business day of Santo Domingo, the one the server checks.
const today = () => businessToday();

const KIND: Record<string, string> = {
  Service: "Servicio", Charge: "Cargo", Adjustment: "Ajuste", Package: "Paquete", Excess: "Exceso", Minimum: "Mínimo",
};
const MOVEMENT: Record<string, string> = {
  Application: "Pago aplicado", ApplicationReversal: "Reverso de pago", LegacyPayment: "Pago histórico",
  LegacyCredit: "Crédito histórico",
};
/** The notes of the invoice have their own section, with their PDF. */
const NOTE_MOVEMENTS = new Set(["Invoice", "Credit", "Debit"]);

function InvoiceDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { getTreasuryInvoice, financeRevision } = useAirlineSession();
  const read = useCallback((signal: AbortSignal) => getTreasuryInvoice(id, signal), [getTreasuryInvoice, id]);
  // 4-N25: while a payment or a live change reloads it, the detail on screen stays.
  const snapshot = useLiveSnapshot<AirlineTreasuryInvoiceDetail>(id, financeRevision, read);
  const detail = snapshot.data;
  const payments = detail?.movements.filter(item => !NOTE_MOVEMENTS.has(item.kind)) ?? [];
  return <section className={styles.panel} aria-label="Detalle de factura">
    <div className={styles.requestCardHeading}>
      <h2>{detail ? invoiceTitle(detail.invoice) : "Factura"}</h2>
      <button type="button" className={styles.loadMore} onClick={onBack}>Volver a facturas</button>
    </div>
    {!detail && !snapshot.failed && <p role="status">Cargando factura…</p>}
    {!detail && snapshot.failed && <div role="alert">
      <p>{snapshot.error instanceof ElevantApiError && snapshot.error.status === 404
        ? "La factura no está disponible para esta cuenta." : "No se pudo consultar la factura. Inténtalo de nuevo."}</p>
      <button type="button" className={styles.loadMore} onClick={snapshot.retry}>Reintentar</button></div>}
    <LiveSnapshotNotice snapshot={snapshot} />
    {detail && <>
      <p className={styles.note}>{detail.invoice.stationCode} · Interno {detail.invoice.number}
        {detail.invoice.dueDate ? ` · Vence el ${detail.invoice.dueDate}` : ""} · {invoiceStatus(detail.invoice)}</p>
      <div className={styles.metrics}>
        <div><span>Total con ITBIS</span><strong>{amount(detail.invoice.currencyCode, detail.invoice.total)}</strong></div>
        <div><span>Pagado</span><strong>{amount(detail.invoice.currencyCode, detail.invoice.applied + detail.invoice.legacyPaid)}</strong></div>
        <div><span>Saldo</span><strong>{amount(detail.invoice.currencyCode, detail.invoice.balance)}</strong></div>
      </div>
      <InvoicePdfButton invoice={detail.invoice} />
      <CardPaymentPanel invoiceId={detail.invoice.id} balance={detail.invoice.balance} currencyCode={detail.invoice.currencyCode}
        onChanged={snapshot.retry} />
      {detail.invoice.fiscalNumber && <p className={styles.note}>Factura de crédito fiscal electrónica simulada. Simulación — sin validez fiscal.</p>}
      <section className={styles.preinvoiceLines} aria-label="Líneas de factura"><h3>Líneas</h3>
        {detail.lines.map(line => <p key={line.id} className={line.parentLineNumber ? styles.nestedLine : undefined}>
          {KIND[line.kind] ?? line.kind} · {line.operationCode} · {line.serviceName} · {amount(detail.invoice.currencyCode, line.amount)}
          {line.reason ? ` · ${line.reason}` : ""}
        </p>)}
      </section>
      <section className={styles.preinvoiceLines} aria-label="Pagos de la factura"><h3>Pagos</h3>
        {payments.length === 0 && <p>Sin pagos registrados.</p>}
        {payments.map(item => <p key={item.id}>
          {MOVEMENT[item.kind] ?? "Movimiento"} · {item.effectiveOn} · {item.reference} · {amount(item.currencyCode, item.amount)}
        </p>)}
      </section>
      {/* 4-N17: each credit or debit note with its e-NCF and its PDF. */}
      <section className={styles.preinvoiceLines} aria-label="Notas de crédito y débito"><h3>Notas de crédito y débito</h3>
        {detail.notes.length === 0 && <p>Sin notas de crédito ni de débito.</p>}
        {detail.notes.map(note => <article key={note.id} className={styles.disputeRecord} aria-label={noteTitle(note)}>
          <strong>{noteTitle(note)} · {amount(note.currencyCode, note.amount)}</strong>
          <p>{note.effectiveOn} · {note.reason}</p>
          <AdjustmentNotePdfButton note={note} />
        </article>)}
      </section>
    </>}
  </section>;
}

/** The amounts of `items` by currency, or «—» when there are none. */
function byCurrency(items: { currency: string; value: number }[]) {
  return [...new Set(items.map(item => item.currency))]
    .map(currency => amount(currency, items.filter(item => item.currency === currency).reduce((sum, item) => sum + item.value, 0)))
    .join(" · ") || "—";
}

/**
 * «Facturas»: the airline's invoices with status, due date, balance and PDF (ADR-0035), and its «Estado de cuenta»
 * (4-N30): the aging, the receipts not applied yet and the credit in its favour.
 */
export function AirlineFinancePage({ airlineName }: { airlineName: string }) {
  const { getTreasuryStatement, financeRevision } = useAirlineSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"invoices" | "statement">("invoices");
  const read = useCallback((signal: AbortSignal) => getTreasuryStatement(today(), undefined, signal), [getTreasuryStatement]);
  // 4-N25: the list stays on screen while a live change or the focus reads it again.
  const snapshot = useLiveSnapshot<AirlineTreasuryStatement>("invoices", financeRevision, read);
  const statement = snapshot.data;
  const invoices = statement?.invoices ?? [];
  const owed = invoices.filter(item => item.balance > 0);
  const balance = (items: AirlineTreasuryInvoice[]) => byCurrency(items.map(item => ({ currency: item.currencyCode, value: item.balance })));
  // 4-N30: credit notes beyond what was owed and receipts not applied yet (a charter's prepayment over its invoice).
  const credit = byCurrency((statement?.aging ?? []).map(item => ({ currency: item.currencyCode,
    value: item.creditBalance + item.unallocated })).filter(item => item.value > 0));

  if (selected) return <div className={styles.page}><InvoiceDetail id={selected} onBack={() => setSelected(null)} /></div>;
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Cuenta financiera · {airlineName}</span>
      <h1>Facturas</h1>
      <p>Facturas emitidas por AVIAM por las operaciones completadas, con su vencimiento y saldo, y el estado de cuenta de tu aerolínea.</p>
    </header>
    <div className={styles.viewSwitch} role="group" aria-label="Vista de la cuenta financiera">
      <button type="button" aria-pressed={view === "invoices"} onClick={() => setView("invoices")}>Facturas</button>
      <button type="button" aria-pressed={view === "statement"} onClick={() => setView("statement")}>Estado de cuenta</button>
    </div>
    {view === "statement" ? <AirlineTreasuryPanel /> : <>
      {!statement && !snapshot.failed && <p role="status">Cargando facturas autorizadas…</p>}
      {!statement && snapshot.failed && <div role="alert"><p>No se pudieron consultar las facturas.</p>
        <button type="button" className={styles.loadMore} onClick={snapshot.retry}>Reintentar</button></div>}
      <LiveSnapshotNotice snapshot={snapshot} />
      {statement && <>
        <div className={styles.metrics} aria-label="Resumen de facturas">
          <div><span>Facturas</span><strong>{invoices.length}</strong></div>
          <div><span>Pendientes</span><strong>{owed.filter(item => item.daysOverdue === 0).length}</strong></div>
          <div><span>Vencidas</span><strong>{owed.filter(item => item.daysOverdue > 0).length}</strong></div>
          <div><span>Saldo pendiente</span><strong>{balance(owed)}</strong></div>
          <div><span>Saldo a favor</span><strong>{credit}</strong></div>
        </div>
        {invoices.length === 0 && <p className={styles.empty}>No hay facturas emitidas para esta aerolínea.</p>}
        {invoices.map(item => <section key={item.id} className={styles.panel} aria-label={invoiceTitle(item)}>
          <span className={styles.kicker}>{item.stationCode} · {invoiceStatus(item)}</span>
          <div className={styles.requestCardHeading}>
            <h2>{invoiceTitle(item)}</h2>
            <strong>Saldo {amount(item.currencyCode, item.balance)}</strong>
          </div>
          <p className={styles.note}>Total {amount(item.currencyCode, item.total)}{item.dueDate ? ` · Vence el ${item.dueDate}` : ""}
            {item.daysOverdue > 0 ? ` · ${item.daysOverdue} días de atraso` : ""}</p>
          <button type="button" className={styles.loadMore} onClick={() => setSelected(item.id)}>Ver detalle</button>
          <InvoicePdfButton invoice={item} />
        </section>)}
      </>}
    </>}
  </div>;
}
