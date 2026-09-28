"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ElevantApiError, type AirlinePreinvoiceDetailResponse,
  type AirlinePreinvoicePageResponse } from "@elevant/api-client";

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
  const { getPreinvoices, getPreinvoice, acceptPreinvoice, financeRevision } = useAirlineSession();
  const [pages, setPages] = useState<AirlinePreinvoicePageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const selectedPreinvoice = useRef<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; status: "loading" | "ready" | "error" | "missing";
    value: AirlinePreinvoiceDetailResponse | null } | null>(null);
  const [acceptance, setAcceptance] = useState<{ id: string | null;
    status: "idle" | "confirm" | "pending" | "success" | "conflict" | "error" }>(
      { id: null, status: "idle" });

  useEffect(() => () => {
    detailGeneration.current += 1;
    selectedPreinvoice.current = null;
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    detailGeneration.current += 1;
    queueMicrotask(() => {
      if (request !== generation.current) return;
      setDetail(null);
      setLoading(true);
    });
    void getPreinvoices(1).then(page => {
      if (request === generation.current) { setPages([page]); setError(false); }
    }).catch(() => { if (request === generation.current) setError(true); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [getPreinvoices, financeRevision, retryKey]);

  const openDetail = useCallback(async (id: string) => {
    const request = ++detailGeneration.current;
    selectedPreinvoice.current = id;
    setAcceptance({ id: null, status: "idle" });
    setDetail({ id, status: "loading", value: null });
    try {
      const value = await getPreinvoice(id);
      if (request === detailGeneration.current)
        setDetail({ id, status: "ready", value });
    } catch (error) {
      if (request === detailGeneration.current)
        setDetail({ id, status: error instanceof ElevantApiError && error.status === 404
          ? "missing" : "error", value: null });
    }
  }, [getPreinvoice]);

  const confirmAcceptance = useCallback(async (id: string) => {
    if (detail?.id !== id || detail.status !== "ready" ||
        detail.value?.status !== "Submitted" || acceptance.id !== id ||
        acceptance.status === "pending") return;
    setAcceptance({ id, status: "pending" });
    try {
      await acceptPreinvoice(id);
      if (selectedPreinvoice.current === id)
        setAcceptance({ id, status: "success" });
    } catch (error) {
      if (selectedPreinvoice.current !== id) return;
      setAcceptance({ id, status: error instanceof ElevantApiError &&
        error.status === 409 ? "conflict" : "error" });
      if (error instanceof ElevantApiError && (error.status === 409 || error.status === 404))
        setRetryKey(current => current + 1);
    }
  }, [acceptPreinvoice, acceptance, detail]);

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
      <p>Consulta las prefacturas publicadas para tu aerolínea y responde a las pendientes.</p>
    </header>
    {acceptance.status === "success" &&
      <p role="status">Aceptación registrada para la prefactura {acceptance.id}. El estado se actualiza desde la API.</p>}
    {acceptance.status === "conflict" &&
      <p role="alert">La prefactura cambió antes de aceptarla. Revisa el estado actualizado.</p>}
    {acceptance.status === "error" && detail?.id !== acceptance.id &&
      <p role="alert">No se pudo confirmar la aceptación. Abre de nuevo la prefactura para revisar o reintentar.</p>}
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
      <button className={styles.loadMore} type="button"
        aria-label={`Ver líneas de prefactura ${item.id}`}
        onClick={() => void openDetail(item.id)}>Ver líneas</button>
      {detail?.id === item.id && detail.status === "loading" &&
        <p role="status">Cargando líneas autorizadas…</p>}
      {detail?.id === item.id && detail.status === "missing" &&
        <p role="alert">La prefactura ya no está disponible para esta cuenta.</p>}
      {detail?.id === item.id && detail.status === "error" &&
        <p role="alert">No se pudo consultar el detalle. Inténtalo de nuevo.</p>}
      {detail?.id === item.id && detail.status === "ready" && detail.value &&
        <div aria-label={`Líneas de prefactura ${item.id}`} className={styles.preinvoiceLines}>
          {detail.value.lines.map(line => <div key={line.id}>
            <strong>{line.serviceName}</strong>
            <span>{line.operationCode} · {line.operationDate}</span>
            <span>{line.executedQuantity} {line.billingUnit} × {amount(item.currencyCode, line.unitPrice)}</span>
            <strong>{amount(item.currencyCode, line.amount)}</strong>
          </div>)}
          {detail.value.status === "Submitted" && acceptance.status === "idle" &&
            <button className={styles.loadMore} type="button"
              onClick={() => setAcceptance({ id: item.id, status: "confirm" })}>
              Aceptar prefactura
            </button>}
          {detail.value.status === "Submitted" && acceptance.id === item.id &&
            acceptance.status === "confirm" && <div>
              <p>Confirma que aceptas las líneas y el total publicados.</p>
              <button className={styles.loadMore} type="button"
                onClick={() => void confirmAcceptance(item.id)}>Confirmar aceptación</button>
              <button className={styles.loadMore} type="button"
                onClick={() => setAcceptance({ id: null, status: "idle" })}>Cancelar</button>
            </div>}
          {acceptance.id === item.id && acceptance.status === "pending" &&
            <p role="status">Registrando aceptación…</p>}
          {acceptance.id === item.id && acceptance.status === "error" && <div role="alert">
            <p>No se pudo confirmar la aceptación. Puedes reintentar con la misma clave.</p>
            <button className={styles.loadMore} type="button"
              onClick={() => void confirmAcceptance(item.id)}>Reintentar aceptación</button>
          </div>}
        </div>}
    </section>)}
    {!loading && !error && preinvoices.length === 0 &&
      <p className={styles.empty}>No hay prefacturas publicadas para esta aerolínea.</p>}
    {pages.at(-1)?.hasMore && <button className={styles.loadMore} type="button"
      disabled={loading} onClick={() => void loadMore()}>
      {loading ? "Cargando…" : "Cargar más prefacturas"}</button>}
  </div>;
}
