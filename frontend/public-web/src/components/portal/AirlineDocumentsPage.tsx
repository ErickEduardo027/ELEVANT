"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { invoiceIssueDates, invoiceNumber, invoiceStatus, STATUS_TONE } from "@/lib/airline-invoices";
import type { AirlineTreasuryInvoice, AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import { businessToday } from "@/lib/business-day";
import { formatDate, formatMoney } from "@/lib/portal-format";
import styles from "./AirlinePortalPage.module.css";
import { invoicePath } from "./AirlineFinancePage";
import { InvoicePdfButton } from "./financeDocuments";
import { LiveSnapshotNotice } from "./LiveSnapshotNotice";
import { ActionGroup, Button, DataTable, StatusBadge } from "./PortalUi";
import { useLiveSnapshot } from "./useLiveSnapshot";

// 4-N10: the cutoff is the business day of Santo Domingo, the one the server checks.
const today = () => businessToday();

/** Every invoice PDF of the airline, addressed by the invoice id (ADR-0035). */
export function AirlineDocumentsPage() {
  const { getTreasuryStatement, financeRevision } = useAirlineSession();
  const read = useCallback((signal: AbortSignal) => getTreasuryStatement(today(), undefined, signal), [getTreasuryStatement]);
  // 4-N25: the documents stay on screen while a live change or the focus reads them again.
  const snapshot = useLiveSnapshot<AirlineTreasuryStatement>("documents", financeRevision, read);
  const invoices = snapshot.data?.invoices ?? [];
  const issued = useMemo(() => invoiceIssueDates(snapshot.data?.movements ?? []), [snapshot.data]);
  return <div className={styles.page}>
    <header className={styles.billingHeader}>
      <div>
        <span className={styles.kicker}>Repositorio autorizado</span>
        <h1>Documentos</h1>
        <p>Facturas emitidas para su aerolínea en PDF.</p>
      </div>
    </header>
    {!snapshot.data && !snapshot.failed && <p role="status">Cargando documentos autorizados…</p>}
    {!snapshot.data && snapshot.failed && <div role="alert" className={styles.notice} data-tone="danger">
      <p>No se pudo actualizar la consulta de documentos.</p>
      <ActionGroup><Button onClick={snapshot.retry}>Reintentar</Button></ActionGroup></div>}
    <LiveSnapshotNotice snapshot={snapshot} />
    {snapshot.data && <DataTable<AirlineTreasuryInvoice> caption="Documentos de facturas" rows={invoices} rowKey={item => item.id}
      empty="No hay facturas emitidas para esta aerolínea." columns={[
        { key: "number", header: "Factura", cell: item =>
          <Link href={invoicePath(item.id)} prefetch={false}>{invoiceNumber(item)}</Link> },
        { key: "station", header: "Estación", cell: item => item.stationCode },
        { key: "issued", header: "Emisión", cell: item => formatDate(issued.get(item.id)) },
        { key: "status", header: "Estado", cell: item => { const status = invoiceStatus(item);
          return <StatusBadge tone={STATUS_TONE[status]}>{status}</StatusBadge>; } },
        { key: "total", header: "Total", numeric: true, cell: item => formatMoney(item.currencyCode, item.total) },
        { key: "pdf", header: <span className={styles.visuallyHidden}>PDF</span>, label: "",
          cell: item => <ActionGroup><InvoicePdfButton invoice={item} /></ActionGroup> },
      ]} />}
  </div>;
}
