"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ElevantApiError, type AirlineContractPageResponse } from "@elevant/api-client";
import type { AirlineDraftData } from "@/components/auth/AirlineSessionProvider";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { AirlineContractSignature } from "./AirlineContractSignature";
import { ContractPdfActions } from "./ContractPdfActions";
import { AirlinePermitsSection, ContractTimeline } from "./AirlinePermitsSection";
import { billingUnitLabel } from "@/lib/billing-units";
import styles from "./AirlinePortalPage.module.css";

const STATUS: Record<string, string> = {
  Draft: "Borrador", Active: "Activo", Suspended: "Suspendido",
  Terminated: "Terminado", Expired: "Vencido",
};

/** Why an observation was refused, by its Problem Details code; the server title is never shown. */
const COMMENT_ERRORS: Record<string, string> = {
  version_conflict: "El borrador cambió mientras escribía. Revise la versión actual y envíe de nuevo su observación.",
  draft_closed: "Este borrador ya no admite observaciones: Contratos lo cerró o ya fue aprobado.",
  comment_required: "Escriba la observación (hasta 2000 caracteres).",
  not_found: "Este borrador ya no está disponible.",
  idempotency_conflict: "Esa observación ya se envió con otro texto. Revise el borrador e intente de nuevo.",
  expected_version_required: "Actualice la página antes de enviar la observación.",
};

/** Message for a refused or uncertain observation, and whether the draft must be read again. */
function commentFailure(error: unknown): { text: string; settled: boolean; reload: boolean } {
  if (error instanceof ElevantApiError && error.status >= 400 && error.status < 500) {
    const known = error.code ? COMMENT_ERRORS[error.code] : undefined;
    return { text: known ?? (error.status === 403 ? "Su acceso no permite comentar este borrador."
      : "No se pudo enviar la observación. Revise el texto e intente de nuevo."), settled: true,
      reload: error.status === 409 || error.status === 404 };
  }
  return { text: "No se pudo confirmar el envío. Intente de nuevo: la observación no se enviará dos veces.",
    settled: false, reload: false };
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
}

export function AirlineContractPage() {
  const { session, getContracts, getDrafts, commentDraft, downloadContractDraft, draftRevision } = useAirlineSession();
  const [reloadDrafts, setReloadDrafts] = useState(0);
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
  }, [accountId, getContracts, getDrafts, draftRevision, reloadDrafts]);

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
      <p>Revise borradores y comente las condiciones propuestas. El contrato se activa cuando Finanzas lo aprueba, ambas partes lo firman y su permiso de operación está verificado y vigente.</p>
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
    <AirlinePermitsSection />
    {draftError && <section className={styles.panel} role="alert">No se pudieron cargar los borradores. Actualice la página para volver a intentarlo.</section>}
    {drafts.length > 0 && <section className={styles.contractGrid} aria-label="Borradores para revisión">
      {drafts.map(draft => <AirlineDraftCard key={draft.id} draft={draft} onComment={commentDraft}
        onDownload={downloadContractDraft} onReload={() => setReloadDrafts(value => value + 1)} />)}
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
              <strong>{rate.serviceName}</strong><span>{rate.serviceCode} · por {billingUnitLabel(rate.billingUnit)}</span>
              <span>Precio por {billingUnitLabel(rate.billingUnit)}: {money(rate.unitPrice, version.currencyCode)} · cantidad mínima {rate.minimumQuantity}</span>
            </div>) : <p>Sin tarifas registradas en esta versión.</p>}
          </div>
          <AirlineContractSignature versionId={version.id} fileName={`contrato-${contract.code}-v${version.versionNumber}.pdf`} />
          <ContractTimeline versionId={version.id} />
        </section>)}
      </article>)}
    </div>}
    {hasMore && <button className={styles.loadMore} type="button" disabled={loading}
      onClick={() => void loadMore()}>{loading ? "Cargando…" : "Cargar más contratos"}</button>}
  </div>;
}

function AirlineDraftCard({ draft, onComment, onDownload, onReload }: {
  draft: AirlineDraftData;
  onComment: (versionId: string, body: string, expectedVersion: string, idempotencyKey: string) => Promise<void>;
  onDownload: (versionId: string) => Promise<Blob>;
  onReload: () => void;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // The key of an uncertain attempt is reused for the same text, so a retry never comments twice.
  const pending = useRef<{ key: string; body: string } | null>(null);
  const inFinance = draft.versionStatus === "PendingFinanceApproval";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!draft.version) { setMessage(COMMENT_ERRORS.expected_version_required); return; }
    if (pending.current?.body !== text) pending.current = { key: crypto.randomUUID(), body: text };
    setBusy(true); setMessage("");
    try {
      await onComment(draft.id, text, draft.version, pending.current.key);
      pending.current = null;
      setBody("");
      setMessage("Observación enviada a Contratos.");
    } catch (error) {
      const failure = commentFailure(error);
      if (failure.settled) pending.current = null;
      setMessage(failure.text);
      if (failure.reload) onReload();
    } finally { setBusy(false); }
  }
  return <article className={styles.panel}>
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>{inFinance ? "En revisión por Finanzas" : "En revisión"} · {draft.contractCode}</span><h2>Propuesta de contrato</h2></div><strong className={styles.draftBadge}>BORRADOR</strong></div>
    <p className={styles.note}>Este documento todavía no habilita servicios operativos.</p>
    {inFinance && <p className={styles.note}>Finanzas está revisando los precios. Puede seguir enviando observaciones a Contratos.</p>}
    {!inFinance && draft.financeDecision === "Returned" && <p className={styles.note}>Finanzas devolvió esta versión a Contratos para ajustes.</p>}
    <ContractPdfActions load={() => onDownload(draft.id)} fileName={`borrador-${draft.contractCode}.pdf`} label="borrador del contrato" />
    <div className={styles.contractVersion}><h3>Condiciones propuestas</h3><p>Vigencia prevista: {draft.validFrom} — {draft.validTo ?? "sin fecha de fin"}</p><p>Estaciones: {draft.stations.join(", ") || "Por definir"}</p><p>{draft.terms || "Contratos está preparando los términos de esta versión."}</p></div>
    <div className={styles.contractRateList}>{draft.rates.map(rate => <div key={rate.id}><strong>{rate.serviceName}</strong><span>Precio por {billingUnitLabel(rate.billingUnit)}: {rate.isConfirmed ? money(rate.unitPrice, draft.currencyCode) : "por definir"}</span><span>Cantidad mínima: {rate.minimumQuantity}</span></div>)}</div>
    <div className={styles.contractVersion}><h3>Observaciones</h3>{draft.comments.length ? <ul className={styles.draftComments}>{draft.comments.map(comment => <li key={comment.id}><strong>{comment.isAirline ? comment.author : "Respuesta de Contratos"}</strong><p>{comment.body}</p><small>{new Date(comment.at).toLocaleString("es-DO")}</small></li>)}</ul> : <p>Aún no hay observaciones.</p>}
      <form onSubmit={submit} className={styles.draftCommentForm}><label htmlFor={`draft-comment-${draft.id}`}>Enviar una observación a Contratos</label><textarea id={`draft-comment-${draft.id}`} required maxLength={2000} rows={3} value={body} onChange={event => setBody(event.target.value)} /><button disabled={busy || !body.trim()} type="submit">{busy ? "Enviando…" : "Enviar observación"}</button>{message && <p role="status">{message}</p>}</form>
    </div>
  </article>;
}
