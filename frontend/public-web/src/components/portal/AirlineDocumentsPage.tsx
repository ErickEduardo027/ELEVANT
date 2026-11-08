"use client";

import { useEffect, useState } from "react";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import type { AirlineTreasuryStatement } from "@/lib/airline-treasury-service";
import { amount, InvoicePdfButton, invoiceStatus, invoiceTitle } from "./AirlineFinancePage";
import styles from "./AirlinePortalPage.module.css";
import { businessToday } from "@/lib/business-day";

// 4-N10: the cutoff is the business day of Santo Domingo, the one the server checks.
const today = () => businessToday();

/** Every invoice PDF of the airline, addressed by the invoice id (ADR-0035). */
export function AirlineDocumentsPage() {
  const { getTreasuryStatement, financeRevision } = useAirlineSession();
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ key: string; data: AirlineTreasuryStatement | null; error: boolean }>(
    { key: "", data: null, error: false });
  const key = `${financeRevision}|${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void getTreasuryStatement(today(), undefined, controller.signal)
      .then(data => { if (active) setState({ key, data, error: false }); })
      .catch(() => { if (active) setState({ key, data: null, error: true }); });
    return () => { active = false; controller.abort(); };
  }, [getTreasuryStatement, key]);
  const live = state.key === key ? state : null;
  const invoices = live?.data?.invoices ?? [];
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Repositorio autorizado</span>
      <h1>Documentos</h1>
      <p>Facturas emitidas para tu aerolínea en PDF.</p>
    </header>
    {!live && <p role="status">Cargando documentos autorizados…</p>}
    {live?.error && <div role="alert">No se pudo actualizar la consulta de documentos.
      <button className={styles.loadMore} type="button" onClick={() => setRetry(value => value + 1)}>Reintentar</button></div>}
    {live?.data && invoices.length === 0 && <p className={styles.empty}>No hay facturas emitidas para esta aerolínea.</p>}
    {invoices.map(item => <section className={styles.panel} key={item.id} aria-label={`Documentos de ${invoiceTitle(item)}`}>
      <span className={styles.kicker}>{item.stationCode} · {invoiceStatus(item)}</span>
      <h2>{invoiceTitle(item)}</h2>
      <p className={styles.note}>Total {amount(item.currencyCode, item.total)}{item.dueDate ? ` · Vence el ${item.dueDate}` : ""}</p>
      <InvoicePdfButton invoice={item} />
    </section>)}
  </div>;
}
