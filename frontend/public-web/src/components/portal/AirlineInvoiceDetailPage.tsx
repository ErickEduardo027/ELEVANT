"use client";

import { useCallback, useMemo } from "react";
import { ElevantApiError } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { invoiceIssueDates, invoiceStatus, invoiceTitle, noteTitle, STATUS_TONE } from "@/lib/airline-invoices";
import type { AirlineTreasuryInvoiceDetail, AirlineTreasuryMovement, AirlineTreasuryNote } from "@/lib/airline-treasury-service";
import { billingUnitLabel } from "@/lib/billing-units";
import { formatAmount, formatDate, formatMoney } from "@/lib/portal-format";
import styles from "./AirlinePortalPage.module.css";
import { INVOICES_PATH } from "./AirlineFinancePage";
import { CardPaymentPanel } from "./CardPaymentPanel";
import { AdjustmentNotePdfButton, InvoicePdfButton } from "./financeDocuments";
import { LiveSnapshotNotice } from "./LiveSnapshotNotice";
import { ActionGroup, Button, ButtonLink, DataTable, StatusBadge } from "./PortalUi";
import { useLiveSnapshot } from "./useLiveSnapshot";

type Line = AirlineTreasuryInvoiceDetail["lines"][number];

const KIND: Record<string, string> = {
  Service: "Servicio", Charge: "Cargo", Adjustment: "Ajuste", Package: "Paquete", Excess: "Exceso", Minimum: "Mínimo",
};
const MOVEMENT: Record<string, string> = {
  Application: "Pago aplicado", ApplicationReversal: "Reverso de pago", LegacyPayment: "Pago histórico",
  LegacyCredit: "Crédito histórico",
};
/** The invoice itself and its notes have their own sections, with their PDF. */
const NOTE_MOVEMENTS = new Set(["Invoice", "Credit", "Debit"]);

const QUANTITY = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 4 });
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * One invoice on its own page (`/portal/finanzas/facturas/[id]`), so the browser's Back and a reload keep it: its
 * status, amounts and dates, its lines, payments and notes in tables, «Descargar factura (PDF)» and, while it has a
 * balance, the card payment as the page's only primary action.
 */
export function AirlineInvoiceDetailPage({ invoiceId }: { invoiceId: string }) {
  const { getTreasuryInvoice, financeRevision } = useAirlineSession();
  const read = useCallback((signal: AbortSignal) => getTreasuryInvoice(invoiceId, signal), [getTreasuryInvoice, invoiceId]);
  // 4-N25: while a payment or a live change reloads it, the detail on screen stays.
  const snapshot = useLiveSnapshot<AirlineTreasuryInvoiceDetail>(invoiceId, financeRevision, read);
  const detail = snapshot.data;
  const invoice = detail?.invoice;
  const issued = useMemo(() => invoice ? invoiceIssueDates(detail.movements).get(invoice.id) : undefined, [detail, invoice]);
  const payments = detail?.movements.filter(item => !NOTE_MOVEMENTS.has(item.kind)) ?? [];
  const currency = invoice?.currencyCode ?? "";
  const status = invoice ? invoiceStatus(invoice) : null;

  return <div className={styles.page}>
    <div><ButtonLink variant="ghost" href={INVOICES_PATH}>← Volver a facturas</ButtonLink></div>
    <section className={styles.section} aria-label="Detalle de factura">
      <header className={styles.billingHeader}>
        <div>
          <span className={styles.kicker}>Factura{invoice ? ` · Estación ${invoice.stationCode}` : ""}</span>
          <h1>{invoice ? invoiceTitle(invoice) : "Factura"}</h1>
          {invoice && status && <div className={styles.headerMeta}>
            <StatusBadge tone={STATUS_TONE[status]}>{status}</StatusBadge>
            <span>Emitida el {formatDate(issued)}</span>
            <span>Vence el {formatDate(invoice.dueDate)}</span>
            {invoice.daysOverdue > 0 && invoice.balance > 0 && <span>{plural(invoice.daysOverdue, "día", "días")} de atraso</span>}
            {invoice.fiscalNumber && <span>Interno {invoice.number}</span>}
          </div>}
        </div>
        {invoice && <ActionGroup label="Acciones de la factura">
          <InvoicePdfButton invoice={invoice} text="Descargar factura (PDF)" />
        </ActionGroup>}
      </header>
      {!detail && !snapshot.failed && <p role="status">Cargando factura…</p>}
      {!detail && snapshot.failed && <div role="alert" className={styles.notice} data-tone="danger">
        <p>{snapshot.error instanceof ElevantApiError && snapshot.error.status === 404
          ? "La factura no está disponible para esta cuenta." : "No se pudo consultar la factura. Inténtelo de nuevo."}</p>
        <ActionGroup><Button onClick={snapshot.retry}>Reintentar</Button></ActionGroup></div>}
      <LiveSnapshotNotice snapshot={snapshot} />
      {detail && invoice && <>
        {invoice.fiscalNumber && <p className={styles.note}>Factura de crédito fiscal electrónica simulada. Simulación — sin validez fiscal.</p>}
        <div className={styles.invoiceLayout}>
          <div className={styles.section}>
            <dl className={styles.facts} aria-label="Importes de la factura">
              <div><dt>Total con ITBIS</dt><dd>{formatMoney(currency, invoice.total)}</dd></div>
              <div><dt>Pagado</dt><dd>{formatMoney(currency, invoice.applied + invoice.legacyPaid)}</dd></div>
              {invoice.credited + invoice.legacyCredited > 0 &&
                <div><dt>Notas de crédito</dt><dd>{formatMoney(currency, invoice.credited + invoice.legacyCredited)}</dd></div>}
              {invoice.debited > 0 && <div><dt>Notas de débito</dt><dd>{formatMoney(currency, invoice.debited)}</dd></div>}
              <div><dt>Saldo</dt><dd>{formatMoney(currency, invoice.balance)}</dd></div>
            </dl>
            <section className={styles.section} aria-label="Líneas de factura">
              <h2>Líneas</h2>
              <DataTable<Line> caption={`Líneas de ${invoiceTitle(invoice)}`} rows={detail.lines} rowKey={line => line.id}
                nested={line => line.parentLineNumber !== null} empty="La factura no tiene líneas."
                totalLabel="Total de la factura (con ITBIS)" columns={[
                  { key: "operation", header: "Operación", nowrap: true, cell: line => <span className={styles.cellStack}>{line.operationCode}
                    <span className={styles.subtle}>{formatDate(line.operationDate)}</span></span> },
                  { key: "service", header: "Servicio", minWidth: "15rem", cell: line => <span className={styles.cellStack}>
                    <span>{KIND[line.kind] ?? line.kind} · {line.serviceName}</span>
                    {line.reason && <span className={styles.subtle}>{line.reason}</span>}</span> },
                  { key: "quantity", header: "Cantidad", numeric: true, nowrap: true, cell: line => <span className={styles.cellStack}>
                    {QUANTITY.format(line.quantity)}
                    {line.billingUnit && <span className={styles.subtle}>por {billingUnitLabel(line.billingUnit)}</span>}</span> },
                  { key: "price", header: "Precio unitario", numeric: true, cell: line => formatAmount(line.unitPrice) },
                  { key: "amount", header: invoice.fiscalNumber ? `Total con ITBIS (${currency})` : `Importe (${currency})`,
                    label: invoice.fiscalNumber ? "Total con ITBIS" : "Importe", numeric: true,
                    cell: line => formatAmount(line.amount), total: formatMoney(currency, invoice.total) },
                ]} />
              {/* The portal API gives each line's gross only; net and ITBIS per line need the backend. */}
              {invoice.fiscalNumber && detail.lines.length > 0 && <p className={styles.subtle}>
                El precio unitario no incluye ITBIS (18 %); el total de cada línea sí lo incluye.</p>}
            </section>
            <section className={styles.section} aria-label="Pagos de la factura">
              <h2>Pagos</h2>
              <DataTable<AirlineTreasuryMovement> caption={`Pagos de ${invoiceTitle(invoice)}`} rows={payments}
                rowKey={item => item.id} empty="Sin pagos registrados." totalLabel="Total pagado" columns={[
                  { key: "date", header: "Fecha", cell: item => formatDate(item.effectiveOn) },
                  { key: "kind", header: "Tipo", cell: item => MOVEMENT[item.kind] ?? "Movimiento" },
                  { key: "reference", header: "Referencia", cell: item => item.reference || "—" },
                  { key: "amount", header: "Importe", numeric: true, cell: item => formatMoney(item.currencyCode, item.amount),
                    total: formatMoney(currency, invoice.applied + invoice.legacyPaid) },
                ]} />
            </section>
            {/* 4-N17: each credit or debit note with its e-NCF and its PDF. */}
            <section className={styles.section} aria-label="Notas de crédito y débito">
              <h2>Notas de crédito y débito</h2>
              <DataTable<AirlineTreasuryNote> caption={`Notas de ${invoiceTitle(invoice)}`} rows={detail.notes}
                rowKey={note => note.id} empty="Sin notas de crédito ni de débito." columns={[
                  { key: "note", header: "Nota", cell: note => noteTitle(note) },
                  { key: "date", header: "Fecha", cell: note => formatDate(note.effectiveOn) },
                  { key: "reason", header: "Motivo", cell: note => note.reason },
                  { key: "amount", header: "Importe", numeric: true, cell: note => formatMoney(note.currencyCode, note.amount) },
                  { key: "pdf", header: <span className={styles.visuallyHidden}>PDF</span>, label: "",
                    cell: note => <ActionGroup><AdjustmentNotePdfButton note={note} /></ActionGroup> },
                ]} />
            </section>
          </div>
          <CardPaymentPanel invoiceId={invoice.id} invoiceNumber={invoice.fiscalNumber ?? invoice.number} balance={invoice.balance} currencyCode={currency} onChanged={snapshot.retry} />
        </div>
      </>}
    </section>
  </div>;
}
