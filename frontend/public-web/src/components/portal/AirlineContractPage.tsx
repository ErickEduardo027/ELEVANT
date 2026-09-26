"use client";

import { useCallback, useEffect, useState } from "react";
import type { AirlineContractPageResponse } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import styles from "./AirlinePortalPage.module.css";

const STATUS: Record<string, string> = {
  Draft: "Borrador", Active: "Activo", Suspended: "Suspendido",
  Terminated: "Terminado", Expired: "Vencido",
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
}

export function AirlineContractPage() {
  const { session, getContracts } = useAirlineSession();
  const accountId = session?.actor.accountId;
  const [pages, setPages] = useState<AirlineContractPageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    void getContracts(1).then(page => {
      if (active) { setPages([page]); setError(false); setLoading(false); }
    }).catch(() => {
      if (active) { setError(true); setLoading(false); }
    });
    return () => { active = false; };
  }, [accountId, getContracts]);

  const loadMore = useCallback(async () => {
    if (loading || !pages.at(-1)?.hasMore) return;
    setLoading(true);
    try {
      const next = await getContracts(pages.length + 1);
      setPages(previous => [...previous, next]);
      setError(false);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, [getContracts, loading, pages]);

  const contracts = pages.flatMap(page => page.contracts);
  const hasMore = pages.at(-1)?.hasMore ?? false;

  return <div className={styles.page}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Consulta real · solo lectura</span>
      <h1>Contratos y tarifarios</h1>
      <p>Versiones aprobadas, estaciones cubiertas y tarifas de tu aerolínea. Los contratos vencidos permanecen disponibles como historial.</p>
    </header>
    {loading && pages.length === 0 ? <section className={styles.panel} role="status">Cargando contratos autorizados…</section> : null}
    {error ? <section className={styles.panel} role="alert">
      <p>No se pudieron cargar los contratos. Comprueba la conexión y vuelve a intentarlo.</p>
      {pages.length === 0 && <button type="button" onClick={() => {
        setLoading(true); setError(false);
        void getContracts(1).then(page => { setPages([page]); setLoading(false); })
          .catch(() => { setError(true); setLoading(false); });
      }}>Reintentar</button>}
    </section> : null}
    {!loading && !error && contracts.length === 0 ? <section className={styles.panel}>
      <h2>No hay contratos aprobados</h2>
      <p className={styles.empty}>Todavía no existe un contrato consultable para esta aerolínea.</p>
    </section> : null}
    {contracts.length > 0 && <div className={styles.contractGrid}>
      {contracts.map(contract => <article className={styles.panel} key={contract.id}>
        <div className={styles.sectionHeading}>
          <div><span className={styles.kicker}>Contrato · {contract.code}</span>
            <h2>{contract.code}</h2></div>
          <span>{STATUS[contract.status] ?? contract.status}</span>
        </div>
        <p className={styles.note}>Firmado: {contract.signedOn ?? "Sin fecha registrada"}
          {contract.terminatedOn ? ` · Terminado: ${contract.terminatedOn}` : ""}</p>
        {contract.approvedVersions.map(version => <section key={version.id} className={styles.contractVersion}>
          <h3>Versión aprobada {version.versionNumber}</h3>
          <p>Vigencia: {version.validFrom} — {version.validTo ?? "sin fecha de fin"} · {version.currencyCode}</p>
          <p>Estaciones: {version.stations.map(station => `${station.code} · ${station.name}`).join(", ") || "Sin estaciones registradas"}</p>
          <div className={styles.contractRateList}>
            {version.rates.length > 0 ? version.rates.map(rate => <div key={rate.id}>
              <strong>{rate.serviceName}</strong><span>{rate.serviceCode} · {rate.billingUnit}</span>
              <span>{money(rate.unitPrice, version.currencyCode)} · mínimo {rate.minimumQuantity}</span>
            </div>) : <p>Sin tarifas registradas en esta versión.</p>}
          </div>
        </section>)}
      </article>)}
    </div>}
    {hasMore && <button className={styles.loadMore} type="button" disabled={loading}
      onClick={() => void loadMore()}>{loading ? "Cargando…" : "Cargar más contratos"}</button>}
  </div>;
}
