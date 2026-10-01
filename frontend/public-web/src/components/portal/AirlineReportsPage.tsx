"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AirlineOperationPageResponse, AirlinePreinvoicePageResponse } from "@elevant/api-client";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import styles from "./AirlinePortalPage.module.css";

type ReportSnapshot = {
  revision: string;
  operations: AirlineOperationPageResponse;
  preinvoices: AirlinePreinvoicePageResponse;
};

function formatAmount(currency: string, value: number) {
  return `${currency} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 4,
  }).format(value)}`;
}

/** A bounded, tenant-scoped read model; it deliberately does not claim global KPIs. */
export function AirlineReportsPage({ airlineName }: { airlineName: string }) {
  const { getOperations, getPreinvoices, operationRevision, financeRevision } = useAirlineSession();
  const revision = `${operationRevision}:${financeRevision}`;
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [error, setError] = useState<{ revision: string; retry: number } | null>(null);

  useEffect(() => {
    const request = ++generation.current;
    void Promise.all([getOperations(1), getPreinvoices(1)]).then(([operations, preinvoices]) => {
      if (request !== generation.current) return;
      setSnapshot({ revision, operations, preinvoices });
      setError(null);
    }).catch(() => {
      if (request !== generation.current) return;
      setSnapshot(null);
      setError({ revision, retry });
    });
    return () => { generation.current += 1; };
  }, [getOperations, getPreinvoices, revision, retry]);

  const visible = snapshot?.revision === revision && !error ? snapshot : null;
  const failed = error?.revision === revision && error.retry === retry;

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Consulta autorizada · {airlineName}</span>
      <h1>Reportes operativos y financieros</h1>
      <p>Consulta las operaciones y prefacturas publicadas de tu aerolínea. Esta vista muestra la primera página de cada historial; no calcula puntualidad, cumplimiento ni facturación total sin datos completos.</p>
    </header>
    {!visible && !failed && <p role="status">Cargando reportes autorizados…</p>}
    {failed && <div role="alert" className={styles.unavailable}>
      <p>No se pudieron actualizar los reportes. Los datos anteriores se ocultaron.</p>
      <button type="button" onClick={() => { setError(null); setRetry(value => value + 1); }}>Reintentar reportes</button>
    </div>}
    {visible && <>
      <div className={styles.metrics} aria-label="Registros cargados del historial autorizado">
        <div><span>Operaciones cargadas</span><strong>{visible.operations.operations.length}</strong></div>
        <div><span>Prefacturas cargadas</span><strong>{visible.preinvoices.preinvoices.length}</strong></div>
      </div>
      <section className={styles.panel} aria-label="Reporte de operaciones">
        <div className={styles.sectionHeading}><h2>Operaciones recientes</h2><Link href="/portal/vuelos">Ver historial completo</Link></div>
        {visible.operations.operations.length ? <ul className={styles.previewRows}>
          {visible.operations.operations.map(operation => <li key={operation.id}>
            <span className={styles.kicker}>{operation.stationCode} · {operation.operationDate}</span>
            <strong><Link href={`/portal/vuelos/${encodeURIComponent(operation.id)}`}>{operation.code}</Link></strong>
            <p>Estado: {operation.status}</p>
          </li>)}
        </ul> : <p className={styles.empty}>No hay operaciones registradas para esta aerolínea.</p>}
        {visible.operations.hasMore && <p className={styles.scopeLine}>Hay más operaciones en el historial de vuelos.</p>}
      </section>
      <section className={styles.panel} aria-label="Reporte de prefacturas">
        <div className={styles.sectionHeading}><h2>Prefacturas publicadas recientes</h2><Link href="/portal/finanzas">Ver historial financiero</Link></div>
        {visible.preinvoices.preinvoices.length ? <ul className={styles.previewRows}>
          {visible.preinvoices.preinvoices.map(preinvoice => <li key={preinvoice.id}>
            <span className={styles.kicker}>{preinvoice.stationCode} · {preinvoice.from} a {preinvoice.to}</span>
            <strong>{formatAmount(preinvoice.currencyCode, preinvoice.total)}</strong>
            <p>Estado: {preinvoice.status}</p>
          </li>)}
        </ul> : <p className={styles.empty}>No hay prefacturas publicadas para esta aerolínea.</p>}
        {visible.preinvoices.hasMore && <p className={styles.scopeLine}>Hay más prefacturas en Finanzas.</p>}
      </section>
    </>}
  </div>;
}
