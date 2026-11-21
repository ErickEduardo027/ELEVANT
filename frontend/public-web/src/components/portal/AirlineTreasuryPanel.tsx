"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ElevantApiError } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { invoiceIssueDates, invoiceNumber, invoiceStatus, invoiceTitle, noteTitle, STATUS_TONE, statementLedger,
  sumByCurrency, type LedgerGroup, type LedgerRow } from "@/lib/airline-invoices";
import type { AirlineTreasuryInvoice, AirlineTreasuryInvoiceDetail, AirlineTreasuryNote, AirlineTreasuryReceipt,
  AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import { businessToday } from "@/lib/business-day";
import { formatAmount, formatDate, formatMoney } from "@/lib/portal-format";
import styles from "./AirlinePortalPage.module.css";
import { Amounts, FinanceTabs, invoicePath, useBillingStations } from "./AirlineFinancePage";
import { AdjustmentNotePdfButton } from "./financeDocuments";
import { LiveSnapshotNotice } from "./LiveSnapshotNotice";
import { ActionGroup, Button, ButtonLink, DataTable, StatusBadge } from "./PortalUi";
import { useLiveSnapshot } from "./useLiveSnapshot";

// 4-N10: the cutoff is the business day of Santo Domingo, the one the server checks.
const today = () => businessToday();
const KINDS: Record<string, string> = { Receipt: "Cobro", Application: "Aplicación de cobro", ApplicationReversal: "Reverso de aplicación",
  ReceiptReversal: "Reverso de cobro", Refund: "Devolución", LegacyPayment: "Pago histórico", LegacyCredit: "Crédito histórico", Invoice: "Factura",
  Credit: "Nota de crédito", Debit: "Nota de débito" };
const METHODS: Record<string, string> = { Transfer: "Transferencia", Check: "Cheque", Cash: "Efectivo", Other: "Otro", Card: "Tarjeta" };
const AGING: [string, keyof AirlineTreasuryStatement["aging"][number]][] = [["Vigente", "current"], ["1–30 días", "days1To30"],
  ["31–60 días", "days31To60"], ["61–90 días", "days61To90"], ["Más de 90 días", "days91Plus"]];

type Selection = { kind: "invoice" | "receipt"; id: string };

/**
 * The breakdown of an invoice or a receipt of the statement, in a side drawer that keeps the statement under it. A
 * modal dialog: the focus goes in, Escape and «Cerrar» close it and give the focus back to the row that opened it.
 */
function BreakdownDrawer({ selection, onSelect, onClose }: {
  selection: Selection; onSelect: (selection: Selection) => void; onClose: () => void;
}) {
  const { getTreasuryInvoice, getTreasuryReceipt, financeRevision } = useAirlineSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const anchor = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === "function") { if (!element.open) element.showModal(); }
    else element.setAttribute("open", "");
    return () => { if (typeof element.close === "function" && element.open) element.close(); };
  }, []);
  const read = useCallback((signal: AbortSignal): Promise<AirlineTreasuryInvoiceDetail | AirlineTreasuryReceipt> =>
    selection.kind === "invoice" ? getTreasuryInvoice(selection.id, signal) : getTreasuryReceipt(selection.id, signal),
  [getTreasuryInvoice, getTreasuryReceipt, selection]);
  const snapshot = useLiveSnapshot(`${selection.kind}|${selection.id}`, financeRevision, read);
  const detail = selection.kind === "invoice" && snapshot.data ? snapshot.data as AirlineTreasuryInvoiceDetail : null;
  const receipt = selection.kind === "receipt" && snapshot.data ? snapshot.data as AirlineTreasuryReceipt : null;
  const title = detail ? `${invoiceTitle(detail.invoice)} · ${detail.invoice.stationCode}`
    : receipt ? `${receipt.reference} · ${receipt.stationCode}` : selection.kind === "invoice" ? "Estado de factura" : "Detalle del cobro";

  function notes(items: AirlineTreasuryNote[], currency: string) {
    return <section className={styles.section} aria-label="Notas de ajuste"><h3>Notas de ajuste</h3>
      <DataTable<AirlineTreasuryNote> caption="Notas de ajuste" rows={items} rowKey={note => note.id}
        empty="Sin notas de ajuste emitidas." columns={[
          { key: "note", header: "Nota", cell: note => <span className={styles.cellStack} id={`${anchor}-note-${note.id}`}>
            <span>{noteTitle(note)}</span>
            {note.relatedNoteId && <a href={`#${anchor}-note-${note.relatedNoteId}`}>Nota vinculada: {items.find(n =>
              n.id === note.relatedNoteId)?.number ?? "Ver referencia"}</a>}</span> },
          { key: "date", header: "Fecha", cell: note => formatDate(note.effectiveOn) },
          { key: "lines", header: "Líneas", cell: note => <ul className={styles.cellStack}>{note.lines.map(line => {
            const invoiceLine = detail?.lines.find(item => item.id === line.invoiceLineId);
            return <li key={line.invoiceLineId}>{invoiceLine ? <a href={`#${anchor}-line-${line.invoiceLineId}`}>Línea {invoiceLine.lineNumber} · {invoiceLine.serviceName}</a>
              : "Línea de factura"}{` · Cantidad ${line.quantity} · ${formatMoney(currency, line.amount)}`}</li>;
          })}</ul> },
          { key: "amount", header: "Importe", numeric: true, cell: note => formatMoney(note.currencyCode, note.amount) },
          { key: "pdf", header: <span className={styles.visuallyHidden}>PDF</span>, label: "",
            // 4-N17: the note's PDF, with its e-NCF and its frozen ITBIS.
            cell: note => <ActionGroup><AdjustmentNotePdfButton note={note} /></ActionGroup> },
        ]} />
    </section>;
  }

  return <dialog ref={dialog} className={styles.drawer} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={styles.drawerBody}>
      <header>
        <h2 id={titleId}>{title}</h2>
        <ActionGroup>
          {detail && <ButtonLink href={invoicePath(detail.invoice.id)}>Abrir la factura</ButtonLink>}
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </ActionGroup>
      </header>
      {!snapshot.data && !snapshot.failed && <p role="status">Cargando el documento…</p>}
      {!snapshot.data && snapshot.failed && <div role="alert" className={styles.notice} data-tone="danger">
        <p>{snapshot.error instanceof ElevantApiError && snapshot.error.status === 404
          ? "El documento no está disponible para esta cuenta." : "No se pudo consultar el documento. Inténtelo de nuevo."}</p>
        <ActionGroup><Button onClick={snapshot.retry}>Reintentar</Button></ActionGroup></div>}
      <LiveSnapshotNotice snapshot={snapshot} />
      {detail && <>
        <dl className={styles.facts}>{([["Facturado", detail.invoice.total], ["Pagos históricos", detail.invoice.legacyPaid],
          ["Créditos históricos", detail.invoice.legacyCredited], ["Aplicaciones de cobros", detail.invoice.applied],
          ["Notas de crédito", detail.invoice.credited], ["Notas de débito", detail.invoice.debited], ["Saldo", detail.invoice.balance]] as const)
          .map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{formatMoney(detail.invoice.currencyCode, value)}</dd></div>)}</dl>
        <section className={styles.section} aria-label="Líneas de factura"><h3>Líneas de factura</h3>
          <DataTable caption="Líneas de factura" rows={detail.lines} rowKey={line => line.id} empty="La factura no tiene líneas."
            columns={[
              { key: "line", header: "Línea", cell: line => <span id={`${anchor}-line-${line.id}`}>{line.lineNumber}</span> },
              { key: "operation", header: "Operación", cell: line => line.operationCode },
              { key: "service", header: "Servicio", cell: line => line.serviceName },
              { key: "amount", header: "Importe", numeric: true, cell: line => formatMoney(detail.invoice.currencyCode, line.amount) },
            ]} />
        </section>
        <section className={styles.section} aria-label="Movimientos de factura"><h3>Movimientos de factura</h3>
          <DataTable caption="Movimientos de factura" rows={detail.movements} rowKey={item => item.id} empty="Sin movimientos."
            columns={[
              { key: "date", header: "Fecha", cell: item => formatDate(item.effectiveOn) },
              { key: "kind", header: "Tipo", cell: item => KINDS[item.kind] ?? "Movimiento" },
              { key: "reference", header: "Referencia", cell: item => item.reference || "—" },
              { key: "amount", header: "Importe", numeric: true, cell: item => formatMoney(item.currencyCode, item.amount) },
              { key: "receipt", header: <span className={styles.visuallyHidden}>Cobro</span>, label: "", cell: item => item.receiptId
                ? <Button variant="ghost" onClick={() => onSelect({ kind: "receipt", id: item.receiptId! })}>Ver cobro vinculado</Button> : null },
            ]} />
        </section>
        {notes(detail.notes, detail.invoice.currencyCode)}
      </>}
      {receipt && <>
        <p className={styles.headerMeta}>{METHODS[receipt.method] ?? "Cobro"} · Recibido el {formatDate(receipt.receivedOn)}
          {receipt.reversed ? " · Revertido" : ""}</p>
        <dl className={styles.facts}>{([["Recibido", receipt.amount], ["Aplicado", receipt.applied], ["Devuelto", receipt.refunded],
          ["Disponible", receipt.available]] as const).map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd>{formatMoney(receipt.currencyCode, value)}</dd></div>)}</dl>
        <section className={styles.section} aria-label="Movimientos del cobro"><h3>Movimientos del cobro</h3>
          <DataTable caption="Movimientos del cobro" rows={receipt.movements} rowKey={item => item.id} empty="Sin movimientos."
            columns={[
              { key: "date", header: "Fecha", cell: item => formatDate(item.effectiveOn) },
              { key: "kind", header: "Tipo", cell: item => <span className={styles.cellStack}><span>{KINDS[item.kind] ?? "Movimiento"}</span>
                {item.reason && <span className={styles.subtle}>{item.reason}</span>}</span> },
              { key: "amount", header: "Importe del cobro", label: "Importe", numeric: true,
                cell: item => formatMoney(item.receiptCurrency, item.receiptAmount) },
              { key: "invoice", header: "En la factura", numeric: true, cell: item => item.invoiceId ? <span className={styles.cellStack}>
                {formatMoney(item.invoiceCurrency ?? receipt.currencyCode, item.invoiceAmount)}
                <span className={styles.subtle}>Tasa registrada {item.exchangeRate} · {formatDate(item.exchangeRateOn)}</span></span> : "—" },
              { key: "open", header: <span className={styles.visuallyHidden}>Factura</span>, label: "", cell: item => item.invoiceId
                ? <Button variant="ghost" onClick={() => onSelect({ kind: "invoice", id: item.invoiceId! })}>Ver factura vinculada</Button> : null },
            ]} />
        </section>
      </>}
    </div>
  </dialog>;
}

function LedgerTable({ group, documents }: { group: LedgerGroup; documents: ReadonlyMap<string, string> }) {
  return <DataTable<LedgerRow> caption={`Movimientos en ${group.currency}`} rows={group.rows}
    rowKey={row => `${row.movement.id}|${row.currency}`} totalLabel="Saldo al corte" columns={[
      { key: "date", header: "Fecha", cell: row => formatDate(row.movement.effectiveOn) },
      { key: "kind", header: "Movimiento", cell: row => KINDS[row.movement.kind] ?? "Movimiento" },
      { key: "reference", header: "Documento", cell: row => row.movement.reference
        || (row.movement.invoiceId ? documents.get(row.movement.invoiceId) : undefined) || "—" },
      { key: "debit", header: "Cargo", numeric: true, cell: row => row.debit ? formatAmount(row.debit) : "",
        total: formatAmount(group.debits) },
      { key: "credit", header: "Abono", numeric: true, cell: row => row.credit ? formatAmount(row.credit) : "",
        total: formatAmount(group.credits) },
      { key: "balance", header: `Saldo (${group.currency})`, label: "Saldo", numeric: true, cell: row => formatAmount(row.balance),
        total: formatMoney(group.currency, group.balance) },
    ]} />;
}

/**
 * Customer finance projection: navigation and dated reads only. 4-N30: «Estado de cuenta» with the aging, the
 * movements and their running balance, the documents at the cut-off and the receipts not applied yet; 4-N25: what it
 * shows stays on screen while it is read again. The breakdown of an invoice or a receipt opens in a side drawer.
 */
export function AirlineTreasuryPanel() {
  const { status, session, getTreasuryStatement, financeRevision } = useAirlineSession();
  const stationOptions = useBillingStations();
  const [date, setDate] = useState(today); const [station, setStation] = useState("");
  const [query, setQuery] = useState(() => ({ asOf: today(), stationId: "" }));
  const [selection, setSelection] = useState<Selection | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const accountKey = session?.actor.accountId ?? "";
  const read = useCallback((signal: AbortSignal) => getTreasuryStatement(query.asOf, query.stationId || undefined, signal),
    [getTreasuryStatement, query.asOf, query.stationId]);
  // The scope names the cut-off and the station: another one never shows the previous data.
  const scope = status === "ready" && accountKey ? [accountKey, query.asOf, query.stationId].join("|") : null;
  const snapshot = useLiveSnapshot<AirlineTreasuryStatement>(scope, financeRevision, read);
  const statement = snapshot.data;
  const ledger = useMemo(() => statement ? statementLedger(statement) : [], [statement]);
  const issued = useMemo(() => invoiceIssueDates(statement?.movements ?? []), [statement]);
  const documents = useMemo(() => new Map((statement?.invoices ?? []).map(item => [item.id, invoiceNumber(item)])), [statement]);
  /** `trigger` is the button of the row: the focus goes back to it when the drawer closes. */
  function open(next: Selection, trigger?: HTMLElement) {
    if (trigger) opener.current = trigger;
    setSelection(next);
  }
  // The focus goes back once the dialog is gone: closing a modal dialog restores the focus it found, which on a
  // touch screen is not the row's button.
  const restoreFocus = useRef(false);
  function close() {
    restoreFocus.current = true;
    setSelection(null);
  }
  useEffect(() => {
    if (selection || !restoreFocus.current) return;
    restoreFocus.current = false;
    opener.current?.focus();
  }, [selection]);

  if (status === "loading") return <p role="status">Validando sesión financiera…</p>;
  if (status !== "ready") return <p role="alert">Inicie sesión para consultar sus documentos financieros.</p>;
  return <section className={styles.section} aria-label="Estado de cuenta de aerolínea">
    <form className={styles.filters} aria-label="Consultar estado de cuenta" onSubmit={event => {
      event.preventDefault();
      // The same cut-off asked again reads it again, keeping the statement on screen.
      if (date && date <= today()) { setQuery({ asOf: date, stationId: station }); snapshot.retry(); }
    }}>
      <label>Fecha de corte<input required type="date" value={date} max={today()} onChange={event => setDate(event.target.value)} /></label>
      <label>Estación<select value={station} onChange={event => setStation(event.target.value)}>
        <option value="">Todas las estaciones autorizadas</option>
        {stationOptions.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <ActionGroup><Button type="submit" variant="primary">Consultar estado</Button></ActionGroup>
    </form>
    {!statement && !snapshot.failed && <p role="status">Cargando estado financiero…</p>}
    {!statement && snapshot.failed && <div role="alert" className={styles.notice} data-tone="danger">
      <p>{snapshot.error instanceof ElevantApiError && snapshot.error.status === 404
        ? "El documento no está disponible para esta cuenta." : "No se pudo consultar el estado financiero. Inténtelo de nuevo."}</p>
      <ActionGroup><Button onClick={snapshot.retry}>Reintentar</Button></ActionGroup></div>}
    <LiveSnapshotNotice snapshot={snapshot} />
    {statement && <>
      <p className={styles.note}>Corte: {formatDate(statement.asOf)} · Movimientos y registros hasta el cierre del día (hora de República Dominicana).</p>
      {!statement.aging.length && <p className={styles.empty}>No hay documentos financieros para este corte.</p>}
      {statement.aging.map(a => <section key={a.currencyCode} className={styles.section} aria-label={`Antigüedad ${a.currencyCode}`}>
        <h3>{a.currencyCode}</h3>
        <div className={styles.kpis}>
          <div><span>Saldo al corte</span><strong>{formatMoney(a.currencyCode, a.balance)}</strong><small>Suma de los saldos de sus facturas</small></div>
          <div><span>Cobros sin aplicar</span><strong>{formatMoney(a.currencyCode, a.unallocated)}</strong><small>Pagos recibidos aún no aplicados a una factura</small></div>
          <div><span>Crédito a favor</span><strong>{formatMoney(a.currencyCode, a.creditBalance)}</strong><small>Notas de crédito por encima de lo adeudado</small></div>
        </div>
        <DataTable caption={`Antigüedad de saldos en ${a.currencyCode}`} rows={[a]} rowKey={row => row.currencyCode}
          columns={[...AGING.map(([label, key]) => ({ key, header: label, numeric: true,
            cell: (row: typeof a) => formatAmount(Number(row[key])) })),
          { key: "total", header: "Total vencido y vigente", label: "Total", numeric: true,
            cell: row => formatMoney(row.currencyCode, AGING.reduce((sum, [, key]) => sum + Number(row[key]), 0)) }]} />
      </section>)}
      {ledger.length > 0 && <section className={styles.section} aria-label="Movimientos">
        <h3>Movimientos</h3>
        {ledger.map(group => <LedgerTable key={group.currency} group={group} documents={documents} />)}
      </section>}
      <section className={styles.section} aria-label="Facturas al corte">
        <h3>Facturas al corte</h3>
        <DataTable<AirlineTreasuryInvoice> caption="Facturas al corte" rows={statement.invoices} rowKey={item => item.id}
          empty="No hay facturas a este corte." totalLabel="Total" columns={[
            { key: "number", header: "Factura", cell: item => invoiceNumber(item) },
            { key: "station", header: "Estación", cell: item => item.stationCode },
            { key: "issued", header: "Emisión", cell: item => formatDate(issued.get(item.id)) },
            { key: "due", header: "Vencimiento", cell: item => formatDate(item.dueDate) },
            { key: "status", header: "Estado", cell: item => { const value = invoiceStatus(item);
              return <StatusBadge tone={STATUS_TONE[value]}>{value}</StatusBadge>; } },
            { key: "total", header: "Facturado", numeric: true, cell: item => formatMoney(item.currencyCode, item.total),
              total: <Amounts items={sumByCurrency(statement.invoices.map(item => ({ currency: item.currencyCode, value: item.total })))} /> },
            { key: "applied", header: "Aplicado", numeric: true, cell: item => formatMoney(item.currencyCode, item.applied),
              total: <Amounts items={sumByCurrency(statement.invoices.map(item => ({ currency: item.currencyCode, value: item.applied })))} /> },
            { key: "balance", header: "Saldo", numeric: true, cell: item => formatMoney(item.currencyCode, item.balance),
              total: <Amounts items={sumByCurrency(statement.invoices.map(item => ({ currency: item.currencyCode, value: item.balance })))} /> },
            { key: "open", header: <span className={styles.visuallyHidden}>Desglose</span>, label: "", cell: item =>
              <Button variant="ghost" onClick={event => open({ kind: "invoice", id: item.id }, event.currentTarget)}>Ver{" "}<span className={styles.visuallyHidden}>factura {invoiceNumber(item)}</span></Button> },
          ]} />
      </section>
      <section className={styles.section} aria-label="Cobros">
        <h3>Cobros</h3>
        <DataTable<AirlineTreasuryReceipt> caption="Cobros" rows={statement.receipts} rowKey={item => item.id}
          empty="No hay cobros registrados a este corte." columns={[
            { key: "reference", header: "Referencia", cell: item => item.reference },
            { key: "method", header: "Método", cell: item => METHODS[item.method] ?? "Cobro" },
            { key: "date", header: "Fecha", cell: item => formatDate(item.receivedOn) },
            { key: "amount", header: "Recibido", numeric: true, cell: item => formatMoney(item.currencyCode, item.amount) },
            { key: "available", header: "Disponible", numeric: true, cell: item => formatMoney(item.currencyCode, item.available) },
            { key: "open", header: <span className={styles.visuallyHidden}>Desglose</span>, label: "", cell: item =>
              <Button variant="ghost" onClick={event => open({ kind: "receipt", id: item.id }, event.currentTarget)}>Ver{" "}<span className={styles.visuallyHidden}>cobro {item.reference}</span></Button> },
          ]} />
      </section>
    </>}
    {selection && <BreakdownDrawer key={`${selection.kind}|${selection.id}`} selection={selection} onSelect={next => open(next)} onClose={close} />}
  </section>;
}

/** «Estado de cuenta» on its own page (`/portal/finanzas/estado-de-cuenta`), beside «Facturas». */
export function AirlineStatementPage({ airlineName }: { airlineName: string }) {
  return <div className={styles.page}>
    <header className={styles.billingHeader}>
      <div>
        <span className={styles.kicker}>Cuenta financiera · {airlineName}</span>
        <h1>Estado de cuenta</h1>
        <p>Antigüedad de saldos, movimientos con su saldo acumulado, facturas y cobros de su aerolínea a la fecha de corte que usted elija.</p>
      </div>
    </header>
    <FinanceTabs current="statement" />
    <AirlineTreasuryPanel />
  </div>;
}