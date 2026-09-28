"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AirlinePreinvoicePageResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import styles from "./AirlinePortalPage.module.css";

const STATUS: Record<string, string> = {
  Submitted: "Pendiente de respuesta",
  Disputed: "En disputa",
  Accepted: "Aceptada",
  Invoiced: "Facturada",
};

function amount(currency: string, total: number) {
  return `${currency} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(total)}`;
}

export function AirlineFinancePage({ airlineName }: { airlineName: string }) {
  const { getPreinvoices, operationRevision } = useAirlineSession();
  const [pages, setPages] = useState<AirlinePreinvoicePageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    void getPreinvoices(1).then(page => {
      if (request === generation.current) { setPages([page]); setError(false); }
    }).catch(() => { if (request === generation.current) setError(true); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [getPreinvoices, operationRevision, retryKey]);

  const loadMore = useCallback(async () => {
    if (loading || !pages.at(-1)?.hasMore) return;
    const request = generation.current;
    setLoading(true);
    try {
      const next = await getPreinvoices(pages.length + 1);
      if (request === generation.current) {
        setPages(previous => [...previous, next]);
        setError(false);
      }
    } catch { if (request === generation.current) setError(true); }
    finally { if (request === generation.current) setLoading(false); }
  }, [getPreinvoices, loading, pages]);

  const preinvoices = pages.flatMap(page => page.preinvoices);
  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Cuenta financiera · {airlineName}</span>
      <h1>Finanzas</h1>
      <p>Consulta las prefacturas publicadas para tu aerolínea. Esta vista es de solo lectura.</p>
    </header>
    <div className={styles.metrics} aria-label="Estado de las prefacturas cargadas">
      <div><span>Prefacturas cargadas</span><strong>{preinvoices.length}</strong></div>
      <div><span>Pendientes de respuesta</span><strong>{preinvoices.filter(item => item.status === "Submitted").length}</strong></div>
      <div><span>En disputa</span><strong>{preinvoices.filter(item => item.status === "Disputed").length}</strong></div>
      <div><span>Aceptadas</span><strong>{preinvoices.filter(item => item.status === "Accepted").length}</strong></div>
    </div>
    {loading && pages.length === 0 && <p role="status">Cargando prefacturas autorizadas…</p>}
    {error && <div role="alert"><p>No se pudo actualizar la consulta financiera.</p>
      {pages.length === 0 && <button type="button" onClick={() => {
        setLoading(true); setError(false); setRetryKey(current => current + 1);
      }}>Reintentar</button>}</div>}
    {preinvoices.map(item => <section className={styles.panel} key={item.id}
      aria-label={`Prefactura ${item.id}`}>
      <span className={styles.kicker}>Prefactura · {item.id}</span>
      <div className={styles.requestCardHeading}>
        <h2>{amount(item.currencyCode, item.total)}</h2>
        <span>{STATUS[item.status] ?? item.status}</span>
      </div>
      <p className={styles.note}>{item.stationCode} · {item.from} — {item.to}</p>
      <p className={styles.note}>Registrada el {item.createdAt.slice(0, 10)}.</p>
    </section>)}
    {!loading && !error && preinvoices.length === 0 &&
      <p className={styles.empty}>No hay prefacturas publicadas para esta aerolínea.</p>}
    {pages.at(-1)?.hasMore && <button className={styles.loadMore} type="button"
      disabled={loading} onClick={() => void loadMore()}>
      {loading ? "Cargando…" : "Cargar más prefacturas"}</button>}
  </div>;
}
