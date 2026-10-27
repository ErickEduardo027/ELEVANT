"use client";

import { useCallback, useEffect, useState } from "react";
import type { AirlineContractPageResponse } from "@elevant/api-client";
import type { AirlineDraftData } from "@/components/auth/AirlineSessionProvider";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { AirlineContractSignature } from "./AirlineContractSignature";
import styles from "./AirlinePortalPage.module.css";

const STATUS: Record<string, string> = {
  Draft: "Borrador", Active: "Activo", Suspended: "Suspendido",
  Terminated: "Terminado", Expired: "Vencido",
};

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
}

export function AirlineContractPage() {
  const { session, getContracts, getDrafts, commentDraft, draftRevision } = useAirlineSession();
  const accountId = session?.actor.accountId;
  const [pages, setPages] = useState<AirlineContractPageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [drafts, setDrafts] = useState<AirlineDraftData[]>([]);

  useEffect(() => {
    if (!accountId) return;
    let active = true;
    void Promise.allSettled([getContracts(1), getDrafts()]).then(([history, currentDrafts]) => {
      if (!active) return;
      if (history.status === "fulfilled") { setPages([history.value]); setError(false); }
      else setError(true);
      if (currentDrafts.status === "fulfilled") { setDrafts(currentDrafts.value); setDraftError(false); }
      else setDraftError(true);
      setLoading(false);
    });
    return () => { active = false; };
  }, [accountId, getContracts, getDrafts, draftRevision]);

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
      <span className={styles.kicker}>Consulta real · su aerolínea</span>
      <h1>Contratos y tarifarios</h1>
      <p>Revise borradores y comente las condiciones propuestas. La cobertura operativa aparece tras la activación de Contratos.</p>
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
    {draftError && <section className={styles.panel} role="alert">No se pudieron cargar los borradores. Actualice la página para volver a intentarlo.</section>}
    {drafts.length > 0 && <section className={styles.contractGrid} aria-label="Borradores para revisión">
      {drafts.map(draft => <AirlineDraftCard key={draft.id} draft={draft} onComment={commentDraft} />)}
    </section>}
    {!loading && !error && contracts.length === 0 && drafts.length === 0 ? <section className={styles.panel}>
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
              <span>Precio por {rate.billingUnit}: {money(rate.unitPrice, version.currencyCode)} · cantidad mínima {rate.minimumQuantity}</span>
            </div>) : <p>Sin tarifas registradas en esta versión.</p>}
          </div>
          <AirlineContractSignature versionId={version.id} fileName={`contrato-${contract.code}-v${version.versionNumber}.pdf`} />
        </section>)}
      </article>)}
    </div>}
    {hasMore && <button className={styles.loadMore} type="button" disabled={loading}
      onClick={() => void loadMore()}>{loading ? "Cargando…" : "Cargar más contratos"}</button>}
  </div>;
}

function AirlineDraftCard({ draft, onComment }: {
  draft: AirlineDraftData;
  onComment: (versionId: string, body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await onComment(draft.id, body.trim()); setBody(""); setMessage("Observación enviada a Contratos."); }
    catch { setMessage("No se pudo enviar la observación. Intente de nuevo."); }
    finally { setBusy(false); }
  }
  return <article className={styles.panel}>
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>En revisión · {draft.contractCode}</span><h2>Propuesta de contrato</h2></div><strong className={styles.draftBadge}>BORRADOR</strong></div>
    <p className={styles.note}>Este documento todavía no habilita servicios operativos.</p>
    <div className={styles.contractVersion}><h3>Condiciones propuestas</h3><p>Vigencia prevista: {draft.validFrom} — {draft.validTo ?? "sin fecha de fin"}</p><p>Estaciones: {draft.stations.join(", ") || "Por definir"}</p><p>{draft.terms || "Contratos está preparando los términos de esta versión."}</p></div>
    <div className={styles.contractRateList}>{draft.rates.map(rate => <div key={rate.id}><strong>{rate.serviceName}</strong><span>Precio por {rate.billingUnit}: {rate.isConfirmed ? money(rate.unitPrice, draft.currencyCode) : "por definir"}</span><span>Cantidad mínima: {rate.minimumQuantity}</span></div>)}</div>
    <div className={styles.contractVersion}><h3>Observaciones</h3>{draft.comments.length ? <ul className={styles.draftComments}>{draft.comments.map(comment => <li key={comment.id}><strong>{comment.author}</strong><p>{comment.body}</p><small>{new Date(comment.at).toLocaleString("es-DO")}</small></li>)}</ul> : <p>Aún no hay observaciones.</p>}
      <form onSubmit={submit} className={styles.draftCommentForm}><label htmlFor={`draft-comment-${draft.id}`}>Enviar una observación a Contratos</label><textarea id={`draft-comment-${draft.id}`} required maxLength={2000} rows={3} value={body} onChange={event => setBody(event.target.value)} /><button disabled={busy || !body.trim()} type="submit">{busy ? "Enviando…" : "Enviar observación"}</button>{message && <p role="status">{message}</p>}</form>
    </div>
  </article>;
}
