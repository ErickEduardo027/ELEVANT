"use client";

import { useCallback, useId, useState } from "react";
import { ElevantApiError } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { useAirlineStanding } from "@/components/auth/useAirlineStanding";
import type { AirlineTreasuryStatement, AirlineTreasuryInvoiceDetail, AirlineTreasuryReceipt, AirlineTreasuryNote } from "@/lib/airline-treasury-service";
import { AdjustmentNotePdfButton, invoiceTitle, noteTitle } from "./financeDocuments";
import { LiveSnapshotNotice } from "./LiveSnapshotNotice";
import { useLiveSnapshot } from "./useLiveSnapshot";
import styles from "./AirlinePortalPage.module.css";
import { businessToday } from "@/lib/business-day";

// 4-N10: the cutoff is the business day of Santo Domingo, the one the server checks.
const today = () => businessToday();
const money = (value: number, currency: string) => currency + " " + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
const kinds: Record<string, string> = { Receipt: "Cobro", Application: "Aplicación de cobro", ApplicationReversal: "Reverso de aplicación",
  ReceiptReversal: "Reverso de cobro", Refund: "Devolución", LegacyPayment: "Pago histórico", LegacyCredit: "Crédito histórico", Invoice: "Factura",
  Credit: "Nota de crédito", Debit: "Nota de débito" };
const methods: Record<string, string> = { Transfer: "Transferencia", Check: "Cheque", Cash: "Efectivo", Other: "Otro", Card: "Tarjeta" };
type Data = AirlineTreasuryStatement | AirlineTreasuryInvoiceDetail | AirlineTreasuryReceipt;

/**
 * Customer finance projection: navigation and dated reads only. 4-N30: it is the «Estado de cuenta» of «Facturas», with
 * the aging, the receipts not applied yet and the credit in the airline's favour; 4-N25: what it shows stays on screen
 * while it is read again.
 */
export function AirlineTreasuryPanel({ invoiceId }: { invoiceId?: string }) {
  const { status, session, getTreasuryStatement, getTreasuryInvoice, getTreasuryReceipt, financeRevision } = useAirlineSession();
  const { standing } = useAirlineStanding();
  // 2-N32: invoices keep their stations after a contract is suspended or expires; the filter offers them all.
  const stationOptions = standing.status === "ready" ? standing.data.stations : session?.bootstrap.stations ?? [];
  const [date, setDate] = useState(today); const [station, setStation] = useState("");
  const [query, setQuery] = useState(() => ({ asOf: today(), stationId: "" }));
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<{ id: string; invoiceId: string | null } | null>(null);
  const baseInvoice = selectedInvoice ?? invoiceId ?? null;
  const receiptId = selectedReceipt?.invoiceId === baseInvoice ? selectedReceipt.id : null;
  const mode = receiptId ? "receipt" : baseInvoice ? "invoice" : "statement";
  const accountKey = session?.actor.accountId ?? "";
  const read = useCallback((signal: AbortSignal): Promise<Data> => mode === "receipt" ? getTreasuryReceipt(receiptId!, signal) :
    mode === "invoice" ? getTreasuryInvoice(baseInvoice!, signal) :
    getTreasuryStatement(query.asOf, query.stationId || undefined, signal),
  [baseInvoice, getTreasuryInvoice, getTreasuryReceipt, getTreasuryStatement, mode, query.asOf, query.stationId, receiptId]);
  // The scope names the document and the cut-off: another one never shows the previous data.
  const scope = status === "ready" && accountKey
    ? [accountKey, mode, baseInvoice, receiptId, query.asOf, query.stationId].join("|") : null;
  const snapshot = useLiveSnapshot<Data>(scope, financeRevision, read);
  const anchor = useId();
  const statement = mode === "statement" && snapshot.data ? snapshot.data as AirlineTreasuryStatement : null;
  const detail = mode === "invoice" && snapshot.data ? snapshot.data as AirlineTreasuryInvoiceDetail : null;
  const receipt = mode === "receipt" && snapshot.data ? snapshot.data as AirlineTreasuryReceipt : null;
  function openReceipt(id: string) { setSelectedReceipt({ id, invoiceId: baseInvoice }); }
  function notes(items: AirlineTreasuryNote[]) {
    return <section className={styles.preinvoiceLines} aria-label="Notas de ajuste"><h3>Notas de ajuste</h3>
      {!items.length && <p>Sin notas de ajuste emitidas.</p>}
      {items.map(note => <article key={note.id} id={anchor + "-note-" + note.id} className={styles.disputeRecord} aria-label={noteTitle(note)}>
        <strong>{noteTitle(note)} · {money(note.amount, note.currencyCode)}</strong>
        <p>{note.effectiveOn} · {note.reason}</p>
        {note.relatedNoteId && <a href={"#" + anchor + "-note-" + note.relatedNoteId}>Nota vinculada: {items.find(n => n.id === note.relatedNoteId)?.number ?? "Ver referencia"}</a>}
        <ul>{note.lines.map(line => { const invoiceLine = detail?.lines.find(item => item.id === line.invoiceLineId);
          return <li key={line.invoiceLineId}>{invoiceLine ? <a href={"#" + anchor + "-line-" + line.invoiceLineId}>Línea {invoiceLine.lineNumber} · {invoiceLine.serviceName}</a> : "Línea de factura"}
            {" · Cantidad " + line.quantity + " · " + money(line.amount, note.currencyCode)}</li>;
        })}</ul>
        {/* 4-N17: the note's PDF, with its e-NCF and its frozen ITBIS. */}
        <AdjustmentNotePdfButton note={note} />
      </article>)}
    </section>;
  }
  if (status === "loading") return <p role="status">Validando sesión financiera…</p>;
  if (status !== "ready") return <p role="alert">Inicia sesión para consultar tus documentos financieros.</p>;
  return <section className={styles.panel} aria-label={invoiceId ? "Tesorería de factura" : "Estado de cuenta de aerolínea"}>
    <div className={styles.requestCardHeading}><h2>{mode === "receipt" ? "Detalle del cobro" : mode === "invoice" ? "Estado de factura" : "Estado de cuenta"}</h2>
      {(receiptId || selectedInvoice) && <button type="button" className={styles.loadMore} onClick={() => { if (receiptId) setSelectedReceipt(null); else setSelectedInvoice(null); }}>Volver</button>}</div>
    {mode === "statement" && <form className={styles.disputeForm} onSubmit={event => {
      event.preventDefault();
      // The same cut-off asked again reads it again, keeping the statement on screen.
      if (date && date <= today()) { setQuery({ asOf: date, stationId: station }); snapshot.retry(); }
    }}>
      <label>Fecha de corte<input required type="date" value={date} max={today()} onChange={event => setDate(event.target.value)} /></label>
      <label>Estación<select value={station} onChange={event => setStation(event.target.value)}><option value="">Todas las estaciones autorizadas</option>{stationOptions.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <button type="submit" className={styles.loadMore}>Consultar estado</button>
    </form>}
    {!snapshot.data && !snapshot.failed && <p role="status">Cargando estado financiero…</p>}
    {!snapshot.data && snapshot.failed && <div role="alert"><p>{snapshot.error instanceof ElevantApiError && snapshot.error.status === 404
      ? "El documento no está disponible para esta cuenta." : "No se pudo consultar el estado financiero. Inténtalo de nuevo."}</p>
      <button type="button" className={styles.loadMore} onClick={snapshot.retry}>Reintentar</button></div>}
    <LiveSnapshotNotice snapshot={snapshot} />
    {statement && <>
      <p className={styles.note}>Corte: {statement.asOf} · Movimientos y registros hasta el cierre del día (hora de República Dominicana).</p>
      {!statement.aging.length && <p>No hay documentos financieros para este corte.</p>}
      {statement.aging.map(a => <section key={a.currencyCode} aria-label={"Antigüedad " + a.currencyCode}><h3>{a.currencyCode}</h3>
        <div className={styles.metrics}>{[["Saldo", a.balance], ["Vigente", a.current], ["1–30 días", a.days1To30], ["31–60 días", a.days31To60],
          ["61–90 días", a.days61To90], ["Más de 90 días", a.days91Plus], ["Cobros sin aplicar", a.unallocated], ["Crédito a favor", a.creditBalance]].map(([label, value]) =>
            <div key={String(label)}><span>{label}</span><strong>{money(Number(value), a.currencyCode)}</strong></div>)}</div></section>)}
      <div className={styles.preinvoiceLines}>{statement.invoices.map(i => <article key={i.id} className={styles.disputeRecord} aria-label={invoiceTitle(i)}><div className={styles.requestCardHeading}>
        <strong>{invoiceTitle(i)} · {i.stationCode}</strong><strong>Saldo {money(i.balance, i.currencyCode)}</strong></div>
        <p>Facturado {money(i.total, i.currencyCode)} · Aplicado {money(i.applied, i.currencyCode)}{i.dueDate ? " · Vence " + i.dueDate : ""}</p>
        <button type="button" className={styles.loadMore} onClick={() => setSelectedInvoice(i.id)}>Ver factura {i.fiscalNumber ?? i.number}</button></article>)}</div>
      {statement.receipts.map(r => <article key={r.id} className={styles.disputeRecord} aria-label={"Cobro " + r.reference}><strong>{r.reference}</strong>
        <p>{methods[r.method] ?? "Cobro"} · Recibido {money(r.amount, r.currencyCode)} · Disponible {money(r.available, r.currencyCode)}</p>
        <button type="button" className={styles.loadMore} onClick={() => openReceipt(r.id)}>Ver cobro {r.reference}</button></article>)}
    </>}
    {detail && <>
      <h3>{invoiceTitle(detail.invoice)} · {detail.invoice.stationCode}</h3>
      <div className={styles.metrics}>{[["Facturado", detail.invoice.total], ["Pagos históricos", detail.invoice.legacyPaid], ["Créditos históricos", detail.invoice.legacyCredited],
        ["Aplicaciones de cobros", detail.invoice.applied], ["Notas de crédito", detail.invoice.credited], ["Notas de débito", detail.invoice.debited], ["Saldo", detail.invoice.balance]].map(([label, value]) =>
          <div key={String(label)}><span>{label}</span><strong>{money(Number(value), detail.invoice.currencyCode)}</strong></div>)}</div>
      <section className={styles.preinvoiceLines} aria-label="Líneas de factura"><h3>Líneas de factura</h3>
        {detail.lines.map(line => <p key={line.id} id={anchor + "-line-" + line.id}>Línea {line.lineNumber} · {line.operationCode} · {line.serviceName} · {money(line.amount, detail.invoice.currencyCode)}</p>)}
      </section>
      <section className={styles.preinvoiceLines} aria-label="Movimientos de factura"><h3>Movimientos de factura</h3>
        {detail.movements.map(m => <article key={m.id} className={styles.disputeRecord}><strong>{kinds[m.kind] ?? "Movimiento"} · {money(m.amount, m.currencyCode)}</strong><p>{m.effectiveOn} · {m.reference}</p>
          {m.receiptId && <button type="button" className={styles.loadMore} onClick={() => openReceipt(m.receiptId!)}>Ver cobro vinculado</button>}</article>)}
      </section>{notes(detail.notes)}
    </>}
    {receipt && <><h3>{receipt.reference} · {receipt.stationCode}</h3><p>{methods[receipt.method] ?? "Cobro"} · {receipt.receivedOn}{receipt.reversed ? " · Revertido" : ""}</p>
      <div className={styles.metrics}>{[["Recibido", receipt.amount], ["Aplicado", receipt.applied], ["Devuelto", receipt.refunded], ["Disponible", receipt.available]].map(([label, value]) =>
        <div key={String(label)}><span>{label}</span><strong>{money(Number(value), receipt.currencyCode)}</strong></div>)}</div>
      {receipt.movements.map(m => <article key={m.id} className={styles.disputeRecord}><strong>{kinds[m.kind] ?? "Movimiento"} · {money(m.receiptAmount, m.receiptCurrency)}</strong><p>{m.effectiveOn} · {m.reason}</p>
        {m.invoiceId && <><p>{money(m.invoiceAmount, m.invoiceCurrency ?? receipt.currencyCode)} · Tasa registrada {m.exchangeRate} · {m.exchangeRateOn}</p><button type="button" className={styles.loadMore} onClick={() => { setSelectedReceipt(null); setSelectedInvoice(m.invoiceId); }}>Ver factura vinculada</button></>}
      </article>)}
    </>}
  </section>;
}
