"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AirlineContractPageResponse, ContractSigningResponse, PublicServiceData } from "@elevant/api-client";
import type { AirlineCommercialRequestData, AirlineDraftData } from "@/components/auth/AirlineSessionProvider";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import styles from "./AirlinePortalPage.module.css";

const STATUS: Record<string, string> = {
  Draft: "Borrador", Active: "Activo", Suspended: "Suspendido",
  Terminated: "Terminado", Expired: "Vencido",
};
const SIGNING_STATUS: Record<string, string> = {
  AwaitingEmission: "Pendiente de emisión", Prepared: "PDF preparado", Issued: "Aceptación AVIAM pendiente",
  AwaitingAirline: "Aceptación de su representante pendiente", Finalizing: "Verificando documento",
  Formalized: "Formalizado", Incident: "Incidencia", Cancelled: "Cancelado",
};
type PublicPackage = { id: string; code: string; name: string; versionNumber: number; currencyCode: string;
  components: { serviceId: string; code: string; name: string; billingUnit: string; includedQuantity: number }[] };

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
}

export function AirlineContractPage() {
  const { session, getContracts, getDrafts, commentDraft, draftRevision,
    getContractSigning, getContractSigningLink, getContractDocument, getContractDraftDocument, acceptContract,
    getCommercialCatalog, submitAdditionalServiceRequest, getCommercialRequests } = useAirlineSession();
  const accountId = session?.actor.accountId;
  const [pages, setPages] = useState<AirlineContractPageResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [drafts, setDrafts] = useState<AirlineDraftData[]>([]);
  const [services, setServices] = useState<PublicServiceData[]>([]);
  const [packages, setPackages] = useState<PublicPackage[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedPackages, setSelectedPackages] = useState<string[]>([]);
  const [commercialRequests, setCommercialRequests] = useState<AirlineCommercialRequestData[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState(false);
  const [representativeName, setRepresentativeName] = useState("");
  const [representativeTitle, setRepresentativeTitle] = useState("");
  const [representativePhone, setRepresentativePhone] = useState("");
  const [authorityDeclared, setAuthorityDeclared] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");

  const reloadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const catalog = await getCommercialCatalog();
      setServices(catalog.services);
      setPackages((catalog as typeof catalog & { packages: PublicPackage[] }).packages ?? []);
      setCatalogError(false);
    } catch { setCatalogError(true); }
    finally { setCatalogLoading(false); }
  }, [getCommercialCatalog]);
  useEffect(() => {
    if (!accountId) return;
    const timer = window.setTimeout(() => { void reloadCatalog(); }, 0);
    return () => window.clearTimeout(timer);
  }, [accountId, reloadCatalog]);

  const reloadCommercialRequests = useCallback(async () => {
    setRequestsLoading(true);
    try { setCommercialRequests(await getCommercialRequests()); setRequestsError(false); }
    catch { setRequestsError(true); }
    finally { setRequestsLoading(false); }
  }, [getCommercialRequests]);
  useEffect(() => {
    if (!accountId) return;
    const timer = window.setTimeout(() => { void reloadCommercialRequests(); }, 0);
    return () => window.clearTimeout(timer);
  }, [accountId, reloadCommercialRequests, draftRevision]);

  async function submitAdditional(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || (selectedServices.length === 0 && selectedPackages.length === 0)) return;
    setRequestBusy(true); setRequestMessage("");
    try {
      const receipt = await submitAdditionalServiceRequest({
        requestId: crypto.randomUUID(), serviceIds: selectedServices, packageVersionIds: selectedPackages,
        representativeName: representativeName.trim(), representativeTitle: representativeTitle.trim(),
        representativeEmail: session.actor.email, representativePhone: representativePhone.trim(),
        authorityDeclared,
      });
      setRequestMessage(`Solicitud recibida: ${receipt.reference}. Contratos revisará sus datos y condiciones.`);
      setSelectedServices([]); setSelectedPackages([]); setAuthorityDeclared(false);
      void reloadCommercialRequests();
    } catch { setRequestMessage("No se pudo registrar la solicitud. Revise los datos e intente de nuevo."); }
    finally { setRequestBusy(false); }
  }

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
      <p>Revise solicitudes, propuestas y aceptaciones. Los servicios nuevos se habilitan al formalizar el contrato.</p>
    </header>
    <section className={styles.panel} aria-label="Solicitar servicios adicionales">
      <h2>Solicitar servicios adicionales</h2>
      <p className={styles.note}>La solicitud queda asociada a su aerolínea. Contratos verificará representación, estaciones y tarifas antes de proponer una versión.</p>
      {catalogLoading && <p role="status">Cargando catálogo comercial…</p>}
      {catalogError && <p role="alert">No se pudo cargar el catálogo. <button type="button" onClick={() => void reloadCatalog()}>Reintentar</button></p>}
      <form className={styles.draftCommentForm} onSubmit={submitAdditional}>
        <fieldset><legend>Servicios individuales</legend>{services.map(service =>
          <label key={service.id}><input type="checkbox" checked={selectedServices.includes(service.id)}
            onChange={event => setSelectedServices(current => event.target.checked
              ? [...current, service.id] : current.filter(id => id !== service.id))} /> {service.name}</label>)}</fieldset>
        {packages.length > 0 && <fieldset><legend>Paquetes publicados</legend>{packages.map(item => <label key={item.id}>
          <input type="checkbox" checked={selectedPackages.includes(item.id)} onChange={event => setSelectedPackages(current => {
            const currency = packages.find(selected => current.includes(selected.id))?.currencyCode;
            if (event.target.checked && currency && currency !== item.currencyCode) {
              setRequestMessage(`Seleccione paquetes de una misma moneda (${currency}).`);
              return current;
            }
            setRequestMessage("");
            return event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id);
          })} /> {item.name} · versión {item.versionNumber} · {item.currencyCode}
          <small className={styles.note}>Incluye: {item.components.map(component => component.name).join(", ")}</small>
        </label>)}</fieldset>}
        <label>Nombre del representante<input required maxLength={200} value={representativeName} onChange={event => setRepresentativeName(event.target.value)} /></label>
        <label>Cargo<input required maxLength={200} value={representativeTitle} onChange={event => setRepresentativeTitle(event.target.value)} /></label>
        <label>Teléfono<input required maxLength={50} value={representativePhone} onChange={event => setRepresentativePhone(event.target.value)} /></label>
        <p>Correo verificado: {session?.actor.email}</p>
        <label><input type="checkbox" required checked={authorityDeclared} onChange={event => setAuthorityDeclared(event.target.checked)} /> Confirmo que estoy autorizado para solicitar estos servicios.</label>
        <button type="submit" disabled={requestBusy || catalogLoading || catalogError || (!selectedServices.length && !selectedPackages.length)}>{requestBusy ? "Enviando…" : "Enviar solicitud"}</button>
        {requestMessage && <p role="status">{requestMessage}</p>}
      </form>
    </section>
    <section className={styles.panel} aria-label="Solicitudes comerciales registradas">
      <div className={styles.sectionHeading}><h2>Solicitudes registradas</h2><button type="button" disabled={requestsLoading} onClick={() => void reloadCommercialRequests()}>Actualizar</button></div>
      {requestsLoading && <p role="status">Cargando solicitudes…</p>}
      {requestsError && <p role="alert">No se pudieron cargar las solicitudes. Intente de nuevo.</p>}
      {!requestsLoading && !requestsError && commercialRequests.length === 0 && <p>Aún no hay solicitudes registradas.</p>}
      <div className={styles.contractGrid}>{commercialRequests.map(request => <article key={request.id} className={styles.contractVersion}>
        <strong>{request.reference}</strong><p>Estado: {request.status} · {new Date(request.submittedAt).toLocaleString("es-DO")}</p>
        <p>Servicios: {request.services.map(service => service.name).join(", ") || "Ninguno individual"}</p>
        {request.packages.length > 0 ? <div><p>Paquetes solicitados:</p><ul>{request.packages.map(item => <li key={item.id}>{item.name} (v{item.versionNumber})
          <ul>{item.components.map(component => <li key={component.serviceId}>{component.name} · {component.includedQuantity} {component.unit}</li>)}</ul>
        </li>)}</ul></div> : <p>Paquetes: ninguno</p>}
        {request.decisionReason && <p>Observación: {request.decisionReason}</p>}
        {request.contractId && <p>Contrato asociado: {request.contractId}</p>}
      </article>)}</div>
    </section>
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
        <p className={styles.note}>{contract.requiresElectronicSigning
          ? contract.signedOn
            ? `Formalizado: ${contract.signedOn}`
            : `Aprobado comercialmente · ${contract.signingStatus === "AwaitingEmission" ? "pendiente de emisión" : contract.signingStatus === "Prepared" ? "PDF preparado para emisión" : contract.signingStatus === "Issued" ? "pendiente de la firma de AVIAM" : contract.signingStatus === "AwaitingAirline" ? "pendiente de la firma de su representante" : contract.signingStatus === "Cancelled" ? "acuerdo cancelado" : "firma en proceso"}`
          : `Contrato legado vigente${contract.signedOn ? ` desde ${contract.signedOn}` : ""} · sin firma digital registrada`}
          {contract.terminatedOn ? ` · Terminado: ${contract.terminatedOn}` : ""}</p>
        {!contract.requiresElectronicSigning && <p className={styles.note}>Este expediente anterior no tiene un PDF de firma digital almacenado.</p>}
        {contract.requiresElectronicSigning && <AirlineSigningActions contractId={contract.id}
          accountId={accountId ?? ""} getSigning={getContractSigning}
          getLink={getContractSigningLink} getDraftDocument={getContractDraftDocument}
          acceptContract={acceptContract} getDocument={getContractDocument} />}
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

function AirlineSigningActions({ contractId, accountId, getSigning, getLink, getDraftDocument, acceptContract, getDocument }: {
  contractId: string; accountId: string;
  getSigning: (id: string) => Promise<ContractSigningResponse>;
  getLink: (id: string) => Promise<{ url: string }>;
  getDraftDocument: (id: string) => Promise<Blob>;
  acceptContract: (id: string, expectedDraftSha256: string, requestId: string) => Promise<ContractSigningResponse>;
  getDocument: (id: string) => Promise<Blob>;
}) {
  const [signing, setSigning] = useState<ContractSigningResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reviewedSha256, setReviewedSha256] = useState<string | null>(null);
  const acceptanceRequest = useRef<{ sha256: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const reload = useCallback(async () => {
    try { setSigning(await getSigning(contractId)); setLoadError(false); }
    catch { setLoadError(true); }
  }, [contractId, getSigning]);
  useEffect(() => {
    const initial = window.setTimeout(() => { void reload(); }, 0);
    const timer = window.setInterval(() => { void reload(); }, 60_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [reload]);
  async function openSigning() {
    setBusy(true); setMessage("");
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const result = await getLink(contractId);
      const target = new URL(result.url);
      if (target.protocol !== "https:" ||
          ![".adobe.com", ".adobesign.com", ".echosign.com"].some(
            suffix => target.hostname.endsWith(suffix))) throw new Error("Invalid signing host");
      if (!tab) throw new Error("Popup blocked");
      tab.location.href = target.href;
    } catch { tab?.close(); setMessage("El enlace de firma aún no está disponible para esta cuenta. Compruebe el estado más tarde."); }
    finally { setBusy(false); }
  }
  async function openDocument(load: (id: string) => Promise<Blob>, description: string, review = false) {
    setBusy(true); setMessage("");
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const blob = await load(contractId);
      const url = URL.createObjectURL(blob);
      if (!tab) { URL.revokeObjectURL(url); throw new Error("Popup blocked"); }
      tab.location.href = url;
      if (review) setReviewedSha256(signing?.draftSha256 ?? null);
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch { tab?.close(); setMessage(`No se pudo abrir ${description}. Intente de nuevo.`); }
    finally { setBusy(false); }
  }
  async function confirmAcceptance() {
    if (!signing?.draftSha256 || reviewedSha256 !== signing.draftSha256) return;
    setBusy(true); setMessage("");
    try {
      if (acceptanceRequest.current?.sha256 !== signing.draftSha256) {
        acceptanceRequest.current = { sha256: signing.draftSha256, id: crypto.randomUUID() };
      }
      const updated = await acceptContract(contractId, signing.draftSha256, acceptanceRequest.current.id);
      acceptanceRequest.current = null;
      setSigning(updated); setMessage("Su aceptación quedó registrada.");
      await reload();
    } catch { setMessage("No se pudo registrar la aceptación. Revise el contrato y vuelva a intentarlo."); }
    finally { setBusy(false); }
  }
  const local = signing?.signingMethod === "AcademicLocal";
  return <div className={styles.contractVersion}>
    <h3>Documento contractual</h3>
    {!signing && !loadError && <p role="status">Consultando expediente…</p>}
    {loadError && <p role="alert">No se pudo consultar el expediente. <button type="button" onClick={() => void reload()}>Reintentar</button></p>}
    {signing && <p>Estado: {SIGNING_STATUS[signing.signingStatus] ?? signing.signingStatus}</p>}
    {signing?.aviamAcceptedAt && <p>AVIAM aceptó: {new Date(signing.aviamAcceptedAt).toLocaleString("es-DO")}</p>}
    {signing?.airlineAcceptedAt && <p>Su representante aceptó: {new Date(signing.airlineAcceptedAt).toLocaleString("es-DO")}</p>}
    {signing?.draftSha256 && signing.issuedAt && <><p className={styles.note}>Versión SHA-256: {signing.draftSha256}</p>
      <button type="button" disabled={busy} onClick={() => void openDocument(getDraftDocument, "la versión para revisión", true)}>Revisar contrato PDF</button></>}
    {signing?.signingStatus === "AwaitingAirline" && signing.airlineSignerAccountId === accountId && local &&
      <button type="button" disabled={busy || !signing.draftSha256 || reviewedSha256 !== signing.draftSha256} onClick={() => void confirmAcceptance()}>Confirmar aceptación</button>}
    {signing?.signingStatus === "AwaitingAirline" && signing.airlineSignerAccountId === accountId && !local &&
      <button type="button" disabled={busy} onClick={() => void openSigning()}>Abrir firma en Adobe</button>}
    {signing?.signingStatus === "Formalized" &&
      <button type="button" disabled={busy} onClick={() => void openDocument(getDocument, "el contrato formalizado")}>Ver, descargar o imprimir contrato</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
