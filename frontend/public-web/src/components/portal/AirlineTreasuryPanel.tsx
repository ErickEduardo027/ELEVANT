"use client";

import { useEffect, useId, useState } from "react";
import { ElevantApiError } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import type { AirlineTreasuryStatement, AirlineTreasuryInvoiceDetail, AirlineTreasuryReceipt, AirlineTreasuryNote } from "@/lib/airline-treasury-service";
import styles from "./AirlinePortalPage.module.css";

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number, currency: string) => currency + " " + new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
const kinds: Record<string, string> = { Receipt: "Cobro", Application: "Aplicación de cobro", ApplicationReversal: "Reverso de aplicación",
  ReceiptReversal: "Reverso de cobro", Refund: "Devolución", LegacyPayment: "Pago histórico", LegacyCredit: "Crédito histórico", Invoice: "Factura", Credit: "Crédito", Debit: "Débito" };
type Data = AirlineTreasuryStatement | AirlineTreasuryInvoiceDetail | AirlineTreasuryReceipt;
type Snapshot = { key: string; data: Data | null; error: string };

/** Customer finance projection: navigation and dated reads only. */
export function AirlineTreasuryPanel({ invoiceId }: { invoiceId?: string }) {
  const { status, session, getTreasuryStatement, getTreasuryInvoice, getTreasuryReceipt, financeRevision } = useAirlineSession();
  const [date, setDate] = useState(today); const [station, setStation] = useState("");
  const [query, setQuery] = useState(() => ({ asOf: today(), stationId: "" }));
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<{ id: string; invoiceId: string | null } | null>(null);
  const [retry, setRetry] = useState(0); const [snapshot, setSnapshot] = useState<Snapshot>({ key: "", data: null, error: "" });
  const baseInvoice = selectedInvoice ?? invoiceId ?? null;
  const receiptId = selectedReceipt?.invoiceId === baseInvoice ? selectedReceipt.id : null;
  const mode = receiptId ? "receipt" : baseInvoice ? "invoice" : "statement";
  const accountKey = session?.actor.accountId ?? "";
  const key = [accountKey, baseInvoice, receiptId, query.asOf, query.stationId, financeRevision, retry].join("|");
  const anchor = useId();
  useEffect(() => {
    if (status !== "ready" || !accountKey) return;
    const controller = new AbortController(); let active = true;
    void Promise.resolve().then<Data>(() => mode === "receipt" ? getTreasuryReceipt(receiptId!, controller.signal) :
      mode === "invoice" ? getTreasuryInvoice(baseInvoice!, controller.signal) :
      getTreasuryStatement(query.asOf, query.stationId || undefined, controller.signal)).then(data => {
        if (active) setSnapshot({ key, data, error: "" });
      }).catch(error => {
        if (!active) return;
        setSnapshot({ key, data: null, error: error instanceof ElevantApiError && error.status === 404
          ? "El documento no está disponible para esta cuenta." : "No se pudo consultar el estado financiero. Inténtalo de nuevo." });
      });
    return () => { active = false; controller.abort(); };
  }, [accountKey, baseInvoice, getTreasuryInvoice, getTreasuryReceipt, getTreasuryStatement, key, mode, query, receiptId, status]);
  const live = snapshot.key === key ? snapshot : null;
  const statement = mode === "statement" && live?.data ? live.data as AirlineTreasuryStatement : null;
  const detail = mode === "invoice" && live?.data ? live.data as AirlineTreasuryInvoiceDetail : null;
  const receipt = mode === "receipt" && live?.data ? live.data as AirlineTreasuryReceipt : null;
  function openReceipt(id: string) { setSelectedReceipt({ id, invoiceId: baseInvoice }); }
  function notes(items: AirlineTreasuryNote[]) {
    return <section className={styles.preinvoiceLines} aria-label="Notas de ajuste"><h3>Notas de ajuste</h3>
      {!items.length && <p>Sin notas de ajuste emitidas.</p>}
      {items.map(note => <article key={note.id} id={anchor + "-note-" + note.id} className={styles.disputeRecord}>
        <strong>{note.kind === "Credit" ? "Nota de crédito" : "Nota de débito"} {note.number} · {money(note.amount, note.currencyCode)}</strong>
        <p>{note.effectiveOn} · {note.reason}</p>
        {note.relatedNoteId && <a href={"#" + anchor + "-note-" + note.relatedNoteId}>Nota vinculada: {items.find(n => n.id === note.relatedNoteId)?.number ?? "Ver referencia"}</a>}
        <ul>{note.lines.map(line => { const invoiceLine = detail?.lines.find(item => item.id === line.invoiceLineId);
          return <li key={line.invoiceLineId}>{invoiceLine ? <a href={"#" + anchor + "-line-" + line.invoiceLineId}>Línea {invoiceLine.lineNumber} · {invoiceLine.serviceName}</a> : "Línea de factura"}
            {" · Cantidad " + line.quantity + " · " + money(line.amount, note.currencyCode)}</li>;
        })}</ul>
      </article>)}
    </section>;
  }
  if (status === "loading") return <p role="status">Validando sesión financiera…</p>;
  if (status !== "ready") return <p role="alert">Inicia sesión para consultar tus documentos financieros.</p>;
  return <section className={styles.panel} aria-label={invoiceId ? "Tesorería de factura" : "Estado de cuenta de aerolínea"}>
    <div className={styles.requestCardHeading}><h2>{mode === "receipt" ? "Detalle del cobro" : mode === "invoice" ? "Estado de factura" : "Estado de cuenta"}</h2>
      {(receiptId || selectedInvoice) && <button type="button" className={styles.loadMore} onClick={() => { if (receiptId) setSelectedReceipt(null); else setSelectedInvoice(null); }}>Volver</button>}</div>
    {mode === "statement" && <form className={styles.disputeForm} onSubmit={event => { event.preventDefault(); if (date && date <= today()) setQuery({ asOf: date, stationId: station }); }}>
      <label>Fecha de corte<input required type="date" value={date} max={today()} onChange={event => setDate(event.target.value)} /></label>
      <label>Estación<select value={station} onChange={event => setStation(event.target.value)}><option value="">Todas las estaciones autorizadas</option>{session?.bootstrap.stations.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <button type="submit" className={styles.loadMore}>Consultar estado</button>
    </form>}
    {!live && <p role="status">Cargando estado financiero…</p>}
    {live?.error && <div role="alert"><p>{live.error}</p><button type="button" className={styles.loadMore} onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
    {statement && <>
      <p className={styles.note}>Corte: {statement.asOf} · Movimientos y registros hasta el cierre del día UTC.</p>
      {!statement.aging.length && <p>No hay documentos financieros para este corte.</p>}
      {statement.aging.map(a => <section key={a.currencyCode} aria-label={"Antigüedad " + a.currencyCode}><h3>{a.currencyCode}</h3>
        <div className={styles.metrics}>{[["Saldo", a.balance], ["Vigente", a.current], ["1–30 días", a.days1To30], ["31–60 días", a.days31To60],
          ["61–90 días", a.days61To90], ["Más de 90 días", a.days91Plus], ["Cobros sin aplicar", a.unallocated], ["Crédito a favor", a.creditBalance]].map(([label, value]) =>
            <div key={String(label)}><span>{label}</span><strong>{money(Number(value), a.currencyCode)}</strong></div>)}</div></section>)}
      <div className={styles.preinvoiceLines}>{statement.invoices.map(i => <article key={i.id} className={styles.disputeRecord}><div className={styles.requestCardHeading}>
        <strong>{i.number} · {i.stationCode}</strong><strong>Saldo {money(i.balance, i.currencyCode)}</strong></div>
        <p>Facturado {money(i.total, i.currencyCode)} · Aplicado {money(i.applied, i.currencyCode)}{i.dueDate ? " · Vence " + i.dueDate : ""}</p>
        <button type="button" className={styles.loadMore} onClick={() => setSelectedInvoice(i.id)}>Ver factura {i.number}</button></article>)}</div>
      {statement.receipts.map(r => <article key={r.id} className={styles.disputeRecord}><strong>{r.reference}</strong><p>Recibido {money(r.amount, r.currencyCode)} · Disponible {money(r.available, r.currencyCode)}</p><button type="button" className={styles.loadMore} onClick={() => openReceipt(r.id)}>Ver cobro {r.reference}</button></article>)}
    </>}
    {detail && <>
      <h3>{detail.invoice.number} · {detail.invoice.stationCode}</h3>
      <div className={styles.metrics}>{[["Facturado", detail.invoice.total], ["Pagos históricos", detail.invoice.legacyPaid], ["Créditos históricos", detail.invoice.legacyCredited],
        ["Aplicaciones de cobros", detail.invoice.applied], ["Notas de crédito", detail.invoice.credited], ["Notas de débito", detail.invoice.debited], ["Saldo", detail.invoice.balance]].map(([label, value]) =>
          <div key={String(label)}><span>{label}</span><strong>{money(Number(value), detail.invoice.currencyCode)}</strong></div>)}</div>
      <section className={styles.preinvoiceLines} aria-label="Líneas de factura"><h3>Líneas de factura</h3>
        {detail.lines.map(line => <p key={line.id} id={anchor + "-line-" + line.id}>Línea {line.lineNumber} · {line.operationCode} · {line.serviceName} · {money(line.amount, detail.invoice.currencyCode)}</p>)}
      </section>
      <section className={styles.preinvoiceLines} aria-label="Movimientos de factura"><h3>Movimientos de factura</h3>
        {detail.movements.map(m => <article key={m.id} className={styles.disputeRecord}><strong>{kinds[m.kind] ?? m.kind} · {money(m.amount, m.currencyCode)}</strong><p>{m.effectiveOn} · {m.reference}</p>
          {m.receiptId && <button type="button" className={styles.loadMore} onClick={() => openReceipt(m.receiptId!)}>Ver cobro vinculado</button>}</article>)}
      </section>{notes(detail.notes)}
    </>}
    {receipt && <><h3>{receipt.reference} · {receipt.stationCode}</h3><p>{receipt.receivedOn}{receipt.reversed ? " · Revertido" : ""}</p>
      <div className={styles.metrics}>{[["Recibido", receipt.amount], ["Aplicado", receipt.applied], ["Devuelto", receipt.refunded], ["Disponible", receipt.available]].map(([label, value]) =>
        <div key={String(label)}><span>{label}</span><strong>{money(Number(value), receipt.currencyCode)}</strong></div>)}</div>
      {receipt.movements.map(m => <article key={m.id} className={styles.disputeRecord}><strong>{kinds[m.kind] ?? m.kind} · {money(m.receiptAmount, m.receiptCurrency)}</strong><p>{m.effectiveOn} · {m.reason}</p>
        {m.invoiceId && <><p>{money(m.invoiceAmount, m.invoiceCurrency ?? receipt.currencyCode)} · Tasa registrada {m.exchangeRate} · {m.exchangeRateOn}</p><button type="button" className={styles.loadMore} onClick={() => { setSelectedReceipt(null); setSelectedInvoice(m.invoiceId); }}>Ver factura vinculada</button></>}
      </article>)}
    </>}
  </section>;
}
