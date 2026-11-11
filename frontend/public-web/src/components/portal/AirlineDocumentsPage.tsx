"use client";

import { useCallback } from "react";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import type { AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import { amount, InvoicePdfButton, invoiceStatus, invoiceTitle } from "./financeDocuments";
import { LiveSnapshotNotice } from "./LiveSnapshotNotice";
import { useLiveSnapshot } from "./useLiveSnapshot";
import styles from "./AirlinePortalPage.module.css";
import { businessToday } from "@/lib/business-day";

// 4-N10: the cutoff is the business day of Santo Domingo, the one the server checks.
const today = () => businessToday();

/** Every invoice PDF of the airline, addressed by the invoice id (ADR-0035). */
export function AirlineDocumentsPage() {
  const { getTreasuryStatement, financeRevision } = useAirlineSession();
  const read = useCallback((signal: AbortSignal) => getTreasuryStatement(today(), undefined, signal), [getTreasuryStatement]);
  // 4-N25: the documents stay on screen while a live change or the focus reads them again.
  const snapshot = useLiveSnapshot<AirlineTreasuryStatement>("documents", financeRevision, read);
  const invoices = snapshot.data?.invoices ?? [];
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Repositorio autorizado</span>
      <h1>Documentos</h1>
      <p>Facturas emitidas para tu aerolínea en PDF.</p>
    </header>
    {!snapshot.data && !snapshot.failed && <p role="status">Cargando documentos autorizados…</p>}
    {!snapshot.data && snapshot.failed && <div role="alert">No se pudo actualizar la consulta de documentos.
      <button className={styles.loadMore} type="button" onClick={snapshot.retry}>Reintentar</button></div>}
    <LiveSnapshotNotice snapshot={snapshot} />
    {snapshot.data && invoices.length === 0 && <p className={styles.empty}>No hay facturas emitidas para esta aerolínea.</p>}
    {invoices.map(item => <section className={styles.panel} key={item.id} aria-label={`Documentos de ${invoiceTitle(item)}`}>
      <span className={styles.kicker}>{item.stationCode} · {invoiceStatus(item)}</span>
      <h2>{invoiceTitle(item)}</h2>
      <p className={styles.note}>Total {amount(item.currencyCode, item.total)}{item.dueDate ? ` · Vence el ${item.dueDate}` : ""}</p>
      <InvoicePdfButton invoice={item} />
    </section>)}
  </div>;
}
