"use client";

import Image from "next/image";

import { HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";
import { ElevantApiError, identityDocumentExample, identityDocumentRequirements, type PublicCommercialCatalog,
  type SubmitCommercialRequestRequest } from "@elevant/api-client";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type DivisionsState, effectiveTitle, REPRESENTATIVE_TITLES, type RepresentativeDraft,
  type RepresentativeField, TITLE_OTHER, validateRepresentative,
} from "@/lib/access-request";
import {
  type AirlineProposalDraft, type AirlineProposalField, emptyAirlineProposal, validateAirlineProposal,
} from "@/lib/airline-proposal";
import { createPublicWebApiClient } from "@/lib/elevant-api";
import { countryCodes, countryName, loadDivisions } from "@/lib/geo/catalog";
import { serviceImageFallback } from "@/lib/serviceImages";

type Catalog = PublicCommercialCatalog;
type Representative = RepresentativeDraft;
const emptyRepresentative: Representative = {
  name: "", titleOption: "", titleCustom: "", email: "", phone: "", authorityDeclared: false,
  nationalityCode: "", address: "", country: "", province: "",
  municipality: "", district: "", documentType: "", documentNumber: "",
};
const SERVICES_PER_PAGE = 6;
const DOCUMENT_LABELS: Record<string, string> = { NationalId: "Cédula", Passport: "Pasaporte" };

/** Shapes the number while typing: a cédula as ###-#######-#, a passport in capitals. */
export function formatDocumentNumber(type: string, value: string): string {
  if (type === "NationalId") {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    return [digits.slice(0, 3), digits.slice(3, 10), digits.slice(10)].filter(Boolean).join("-");
  }
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 9);
}
const fieldId = (field: RepresentativeField) => `representative-${field}`;
const proposalId = (field: AirlineProposalField) => `proposal-${field}`;
// Help shown under a field of «Mi aerolínea no aparece»; its control is described by the help and the error.
const PROPOSAL_HINTS: Partial<Record<AirlineProposalField, string>> = {
  icaoCode: "Obligatorio: 3 letras, por ejemplo CMP.",
  iataCode: "Déjelo vacío si la aerolínea no tiene código IATA.",
  websiteUrl: "Ayuda a Contratos a confirmar la aerolínea y a su representante.",
};
const apiOrigin = process.env.NEXT_PUBLIC_ELEVANT_API_URL?.replace(/\/$/, "");
const mediaUrl = (path: string | null | undefined) => path?.startsWith("/api/v1/media/") ? `${apiOrigin}${path}` : path ?? undefined;

export function AccessRequestWizard() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const catalogRef = useRef<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const selectedRef = useRef<string[]>([]);
  const [withdrawnNotice, setWithdrawnNotice] = useState("");
  const [requiresServiceReview, setRequiresServiceReview] = useState(false);
  const [airlineId, setAirlineId] = useState("");
  // «Mi aerolínea no aparece» (1-N25): the applicant describes the airline instead of choosing it.
  const [proposalChosen, setProposalChosen] = useState(false);
  const [proposal, setProposal] = useState<AirlineProposalDraft>(emptyAirlineProposal);
  const [showProposalErrors, setShowProposalErrors] = useState(false);
  const [representative, setRepresentative] = useState(emptyRepresentative);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [reference, setReference] = useState("");
  const [hasPendingSubmission, setHasPendingSubmission] = useState(false);
  const requestId = useRef<string | null>(null);
  const pendingSubmission = useRef<SubmitCommercialRequestRequest | null>(null);
  const submissionInFlight = useRef(false);
  const reconcileAfterSubmit = useRef(false);
  const reconciling = useRef(false);
  const carousel = useRef<HTMLDivElement>(null);
  const [servicePage, setServicePage] = useState(1);
  // Same order as the internal catalog: display order, then name.
  const orderedServices = [...(catalog?.services ?? [])].sort((left, right) =>
    (left.displayOrder ?? 0) - (right.displayOrder ?? 0) || left.name.localeCompare(right.name, "es"));
  const servicePages = Math.max(1, Math.ceil(orderedServices.length / SERVICES_PER_PAGE));
  const currentServicePage = Math.min(servicePage, servicePages);
  const visibleServices = orderedServices.slice((currentServicePage - 1) * SERVICES_PER_PAGE,
    currentServicePage * SERVICES_PER_PAGE);
  const changeServicePage = (direction: 1 | -1) => {
    setServicePage((current) => Math.min(servicePages, Math.max(1, current + direction)));
    carousel.current?.scrollTo?.({ left: 0, behavior: "smooth" });
  };
  const [divisions, setDivisions] = useState<DivisionsState>([]);
  const [divisionsError, setDivisionsError] = useState(false);
  const divisionsCountry = useRef("");
  const [touched, setTouched] = useState<ReadonlySet<RepresentativeField>>(new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);
  // With an empty catalog the only way forward is to describe the airline.
  const proposing = proposalChosen || catalog?.airlines.length === 0;
  const airline = proposing ? undefined : catalog?.airlines.find((item) => item.id === airlineId);
  const proposalCheck = validateAirlineProposal(proposal);
  const proposalError = (field: AirlineProposalField) => showProposalErrors ? proposalCheck.errors[field] : undefined;
  const proposalControl = (field: AirlineProposalField) => {
    const message = proposalError(field);
    const describedBy = [message && `${proposalId(field)}-error`, PROPOSAL_HINTS[field] && `${proposalId(field)}-hint`]
      .filter(Boolean).join(" ");
    return { id: proposalId(field), "aria-invalid": message ? true : undefined, "aria-describedby": describedBy || undefined };
  };
  const airlineName = proposing ? proposal.name.trim() : airline?.name;
  // A proposed ICAO code that is already listed points to the existing profile.
  const listedMatch = proposing && /^[A-Z]{3}$/.test(proposal.icaoCode.trim().toUpperCase())
    ? catalog?.airlines.find((item) => item.icaoCode?.toUpperCase() === proposal.icaoCode.trim().toUpperCase())
    : undefined;
  const validation = validateRepresentative(representative, divisions);
  const fieldError = (field: RepresentativeField) => !validation.ok && (showAllErrors || touched.has(field))
    ? validation.errors[field] : undefined;
  const touch = (field: RepresentativeField) => setTouched((current) =>
    current.has(field) ? current : new Set(current).add(field));
  const control = (field: RepresentativeField) => {
    const message = fieldError(field);
    return {
      id: fieldId(field), onBlur: () => touch(field), "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? `${fieldId(field)}-error` : undefined,
    };
  };
  const division = divisions?.find((item) => item.code === representative.province);
  const location = {
    country: representative.country ? countryName(representative.country) : "",
    province: division?.name ?? "",
    municipality: representative.municipality,
    district: representative.district,
  };
  const districts = division?.districts?.[representative.municipality] ?? [];
  const documentPlaceholder = representative.documentType === "NationalId" ? identityDocumentExample("Cedula")
    : representative.documentType === "Passport" ? identityDocumentExample("Passport", representative.nationalityCode)
      : undefined;
  // Live checklist with the same rules as the API, shown once something is typed.
  const documentRequirements = representative.documentNumber && representative.documentType
    ? identityDocumentRequirements(representative.documentType === "NationalId" ? "Cedula" : "Passport",
      representative.documentNumber, representative.documentType === "Passport" ? representative.nationalityCode : null)
    : [];
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { catalogRef.current = catalog; }, [catalog]);

  const reconcilePending = useCallback(async () => {
    const payload = pendingSubmission.current;
    if (!payload || reconciling.current || submissionInFlight.current) return;
    reconciling.current = true;
    setBusy(true); setError("");
    try {
      const receipt = await createPublicWebApiClient().lookupCommercialRequestReceipt(payload);
      pendingSubmission.current = null;
      setHasPendingSubmission(false);
      setReference(receipt.reference);
    } catch (failure) {
      if (failure instanceof ElevantApiError && [404, 409].includes(failure.status)) {
        pendingSubmission.current = null;
        setHasPendingSubmission(false);
        requestId.current = null;
        setStep(1);
        setRequiresServiceReview(true);
        setError("El envío anterior no se recibió. Revise los servicios y confirme de nuevo.");
      } else {
        setError("No se pudo verificar el envío anterior. Reintente la verificación sin cambiar sus datos.");
      }
    } finally {
      reconciling.current = false;
      setBusy(false);
    }
  }, []);

  const reload = useCallback(async () => {
    if (!apiOrigin) { setCatalogError("El catálogo comercial aún no está configurado."); setLoading(false); return; }
    try {
      const data = await createPublicWebApiClient().getPublicCommercialCatalog({ cache: "no-store" });
      setCatalog(data);
      const retained = selectedRef.current.filter((id) => data.services.some((service) => service.id === id));
      if (retained.length !== selectedRef.current.length) {
        const removed = selectedRef.current.filter((id) => !retained.includes(id));
        const names = removed.map((id) => catalogRef.current?.services.find((service) => service.id === id)?.name ?? id);
        setSelected(retained);
        selectedRef.current = retained;
        if (!pendingSubmission.current) requestId.current = null;
        setStep(1);
        setRequiresServiceReview(true);
        setError("");
        setWithdrawnNotice(`Dejó de estar disponible: ${names.join(", ")}. Revise la oferta y confirme de nuevo su selección antes de continuar.`);
        if (pendingSubmission.current) {
          if (submissionInFlight.current) reconcileAfterSubmit.current = true;
          else void reconcilePending();
        }
      }
      setAirlineId((current) => {
        if (!current || data.airlines.some((item) => item.id === current)) return current;
        requestId.current = null;
        return "";
      });
      setCatalogError("");
    } catch {
      setCatalogError("No se pudo consultar el catálogo. Revise su conexión y reintente.");
    }
    finally { setLoading(false); }
  }, [reconcilePending]);

  useEffect(() => {
    const scheduled = window.setTimeout(() => { void reload(); }, 0);
    const fallback = window.setInterval(() => { void reload(); }, 25_000);
    return () => { window.clearTimeout(scheduled); window.clearInterval(fallback); };
  }, [reload]);
  useEffect(() => {
    if (!apiOrigin) return;
    const hub = new HubConnectionBuilder()
      .withUrl(`${apiOrigin}/hubs/public-catalog`)
      .withAutomaticReconnect()
      .build();
    hub.on("CatalogChangedV1", () => { void reload(); });
    hub.onreconnected(() => { void reload(); });
    void hub.start().catch(() => { /* Refresh still works if push is unavailable. */ });
    return () => { if (hub.state !== HubConnectionState.Disconnected) void hub.stop(); };
  }, [reload]);

  const changeProposal = (changes: Partial<AirlineProposalDraft>) => {
    setProposal((current) => ({ ...current, ...changes }));
    setProposalChosen(true);
    requestId.current = null;
    setError("");
  };
  const toggleProposal = (next: boolean) => {
    setProposalChosen(next);
    setShowProposalErrors(false);
    requestId.current = null;
    setError("");
  };
  const changeRepresentative = (changes: Partial<Representative>) => {
    setRepresentative((current) => ({ ...current, ...changes }));
    requestId.current = null;
    setError("");
  };
  const changeTitle = (titleOption: string) =>
    changeRepresentative(titleOption === TITLE_OTHER ? { titleOption } : { titleOption, titleCustom: "" });
  const fetchDivisions = (country: string) => {
    divisionsCountry.current = country;
    setDivisionsError(false);
    if (!country) { setDivisions([]); return; }
    setDivisions(null);
    loadDivisions(country).then((loaded) => {
      if (divisionsCountry.current === country) setDivisions(loaded);
    }, () => {
      if (divisionsCountry.current === country) setDivisionsError(true);
    });
  };
  const changeCountry = (country: string) => {
    changeRepresentative({ country, province: "", municipality: "", district: "" });
    fetchDivisions(country);
  };
  const changeProvince = (province: string) => changeRepresentative({ province, municipality: "", district: "" });
  const toggleService = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    requestId.current = null;
    setError("");
  };
  const next = () => {
    if (pendingSubmission.current) {
      setError("Verifique primero si el envío anterior fue recibido."); return;
    }
    if (step === 1 && selected.length === 0) { setError("Seleccione al menos un servicio para continuar."); return; }
    if (step === 1 && requiresServiceReview) {
      setRequiresServiceReview(false);
      setWithdrawnNotice("");
    }
    if (step === 2 && proposing && !proposalCheck.ok) {
      setShowProposalErrors(true);
      document.getElementById(`proposal-${proposalCheck.firstInvalidField}`)?.focus();
      setError("Revise los datos de la aerolínea antes de continuar.");
      return;
    }
    if (step === 2 && !proposing && !airlineId) {
      setError("Seleccione la aerolínea que representa o indique que no aparece en el listado."); return;
    }
    if (step === 3 && !validation.ok) {
      setShowAllErrors(true);
      document.getElementById(fieldId(validation.firstInvalidField))?.focus();
      setError("Revise los campos señalados antes de continuar.");
      return;
    }
    setError(""); setStep((current) => Math.min(4, current + 1));
  };
  const submit = async () => {
    if (pendingSubmission.current) { await reconcilePending(); return; }
    if (proposing && !proposalCheck.ok) {
      setShowProposalErrors(true);
      setError("Revise los datos de la aerolínea antes de enviar la solicitud.");
      setStep(2);
      return;
    }
    if (!apiOrigin || (!proposing && !airline) || !selected.length || requiresServiceReview ||
      selected.some((id) => !catalog?.services.some((service) => service.id === id))) {
      setError("Revise los servicios disponibles antes de enviar la solicitud.");
      setStep(1);
      return;
    }
    if (!validation.ok) {
      setShowAllErrors(true);
      setError("Revise los datos del representante antes de enviar la solicitud.");
      setStep(3);
      return;
    }
    setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    const payload: SubmitCommercialRequestRequest = {
      requestId: requestId.current,
      ...(proposing && proposalCheck.ok
        ? { airlineProfileId: null, proposedAirline: proposalCheck.value }
        : { airlineProfileId: airlineId }),
      serviceIds: selected, representativeName: representative.name.trim(),
      representativeTitle: effectiveTitle(representative), representativeEmail: representative.email.trim(),
      representativePhone: representative.phone.trim(), authorityDeclared: representative.authorityDeclared,
      representativeNationalityCode: representative.nationalityCode || null,
      representativeAddress: representative.address.trim() || null,
      representativeCountry: location.country || null,
      representativeProvince: location.province || null,
      representativeMunicipality: location.municipality || null,
      representativeDistrict: location.district || null,
      representativeDocumentType: representative.documentType || null,
      representativeDocumentNumber: representative.documentNumber.trim() || null,
    };
    pendingSubmission.current = payload;
    setHasPendingSubmission(true);
    submissionInFlight.current = true;
    try {
      const result = await createPublicWebApiClient().submitCommercialRequest(payload);
      pendingSubmission.current = null;
      setHasPendingSubmission(false);
      setReference(result.reference);
    } catch (failure) {
      if (failure instanceof ElevantApiError && [404, 409].includes(failure.status)) {
        pendingSubmission.current = null;
        setHasPendingSubmission(false);
        requestId.current = null;
        setError("El catálogo cambió o la solicitud fue modificada. Revise los datos y vuelva a enviarla.");
        await reload();
      } else if (failure instanceof ElevantApiError && failure.status === 400) {
        // The server refused the data: nothing was stored, so a corrected application is a new one.
        pendingSubmission.current = null;
        setHasPendingSubmission(false);
        requestId.current = null;
        setError("La solicitud no superó la validación. Revise los datos de la aerolínea y del representante y vuelva a enviarla.");
      } else if (failure instanceof ElevantApiError && failure.status === 429)
        setError("Demasiados intentos. Espere un momento antes de reintentar.");
      else
        setError("No se pudo confirmar la recepción. Revise la conexión y reintente sin modificar los datos.");
    }
    finally {
      submissionInFlight.current = false;
      setBusy(false);
      const needsReconciliation = reconcileAfterSubmit.current;
      reconcileAfterSubmit.current = false;
      if (needsReconciliation && pendingSubmission.current) void reconcilePending();
    }
  };

  if (reference) return <section className="access-complete" role="status">
    <p className="access-kicker">SOLICITUD RECIBIDA / AVIAM</p>
    <h1>Su solicitud ya está en revisión.</h1>
    <p>Contratos verificará la información de {airlineName || "su aerolínea"} y los servicios seleccionados, y le escribirá a {representative.email.trim()} con su decisión. Conserve esta referencia: identifica su solicitud.</p>
    <strong>{reference}</strong><Link href="/">Volver al inicio <span aria-hidden="true">↗</span></Link>
  </section>;

  return <div className="access-shell">
    <aside className="access-intro">
      <span className="access-intro__serial">SOLICITUD / 001</span>
      <p className="access-kicker">SERVICIOS EN RAMPA · AVIAM</p>
      <h1>Su próxima escala empieza aquí<span>.</span></h1>
      <p>Elija los servicios, confirme la aerolínea y registre a su representante. Revise toda la información antes de enviarla a Contratos.</p>
      <div className="access-intro__rule" />
      <ol className="access-steps" aria-label="Pasos de la solicitud">
        {["Seleccionar servicios", "Información de la aerolínea", "Representante legal", "Confirmación"].map((label, index) =>
          <li key={label} aria-current={step === index + 1 ? "step" : undefined} data-active={step === index + 1} data-done={step > index + 1}>
            <span>0{index + 1}</span><span>{label}</span><span aria-hidden="true">{step > index + 1 ? "✓" : "↗"}</span>
          </li>)}
      </ol>
      <p className="access-intro__foot">OPERACIÓN CONECTADA · DECISIONES VERIFICABLES</p>
    </aside>

    <section className="access-panel" aria-live="polite">
      <div className="access-panel__top"><span>PASO 0{step} / 04</span><span>ACCESO COMERCIAL</span></div>
      {withdrawnNotice && <p className="access-error" role="alert">{withdrawnNotice}</p>}
      {step === 1 && hasPendingSubmission && <button type="button" className="access-back"
        disabled={busy} onClick={() => { void reconcilePending(); }}>Verificar envío anterior</button>}
      {loading ? <p className="access-loading">Cargando servicios y aerolíneas…</p> : step === 1 ? <>
        <div className="access-panel__heading"><p>01 / SERVICIOS</p><h2>¿Qué necesita su operación?</h2><span>Seleccione uno o varios servicios de rampa.</span></div>
        <div className="access-carousel__controls"><span>{selected.length} SELECCIONADOS · PÁGINA {currentServicePage} DE {servicePages}</span><div><button type="button" aria-label="Ver servicios anteriores" disabled={currentServicePage === 1} onClick={() => changeServicePage(-1)}>←</button><button type="button" aria-label="Ver servicios siguientes" disabled={currentServicePage === servicePages} onClick={() => changeServicePage(1)}>→</button></div></div>
        <div className="access-carousel" ref={carousel} aria-label="Servicios disponibles">
          {visibleServices.map((service, offset) => { const index = (currentServicePage - 1) * SERVICES_PER_PAGE + offset; return <article className="access-service" key={service.id} data-selected={selected.includes(service.id)}>
            <div className="access-service__media">
              {service.videoUrl ? <video controls playsInline poster={mediaUrl(service.imageUrl)} src={mediaUrl(service.videoUrl)} aria-label={`Video de ${service.name}`} /> :
                <div className="access-service__image" style={{ backgroundImage: `url(${mediaUrl(service.imageUrl) ?? serviceImageFallback(service)}), url(${serviceImageFallback(service)})` }} role="img" aria-label={service.name} />}
              <span>{String(index + 1).padStart(2, "0")} / AVIAM</span>
            </div>
            <div className="access-service__body"><h3>{service.name}</h3><p>{service.description}</p>
              <button type="button" onClick={() => toggleService(service.id)} aria-pressed={selected.includes(service.id)}>{selected.includes(service.id) ? "Seleccionado ✓" : "Añadir servicio +"}</button>
            </div>
          </article>; })}
          {catalog?.services.length === 0 && <p>No hay servicios publicados por el momento.</p>}
        </div>
      </> : step === 2 ? <>
        <div className="access-panel__heading"><p>02 / AEROLÍNEA</p><h2>¿A cuál aerolínea representa?</h2><span>La ficha se carga desde el catálogo de AVIAM y se revisará antes de aprobar el contrato.</span></div>
        {catalog?.airlines.length === 0 && <p className="access-airline__verification" role="note">Aún no hay aerolíneas publicadas en el listado. Indique los datos de la suya y Contratos la verificará.</p>}
        {!proposing && catalog?.airlines.length !== 0 && <>
          <label className="access-label" htmlFor="airline-select">Seleccione una aerolínea</label>
          <select id="airline-select" className="access-select" value={airlineId} onChange={(event) => { setAirlineId(event.target.value); requestId.current = null; setError(""); }} required>
            <option value="">Buscar en el listado de aerolíneas</option>
            {[...new Set(catalog?.airlines.map((item) => item.region))].map((region) => <optgroup key={region} label={region}>{catalog?.airlines.filter((item) => item.region === region).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</optgroup>)}
          </select>
        </>}
        <div className="access-missing">
          {proposing ? <>
            <span>Describa la aerolínea: Contratos la verificará con una fuente oficial antes de aprobar.</span>
            {catalog?.airlines.length !== 0 && <button type="button" onClick={() => toggleProposal(false)}>Elegir del listado</button>}
          </> : <>
            <span>¿No encuentra su aerolínea?</span>
            <button type="button" onClick={() => toggleProposal(true)}>Mi aerolínea no aparece</button>
          </>}
        </div>
        {proposing && <div className="access-representative access-proposal" role="group" aria-label="Aerolínea que no aparece en el listado">
          <ProposalField field="name" label="Nombre de la aerolínea" error={proposalError("name")} wide>
            <input {...proposalControl("name")} required maxLength={160} autoComplete="organization" value={proposal.name} onChange={(event) => changeProposal({ name: event.target.value })} />
          </ProposalField>
          <ProposalField field="countryCode" label="País de la aerolínea" error={proposalError("countryCode")}>
            <select {...proposalControl("countryCode")} className="access-select" required value={proposal.countryCode} onChange={(event) => changeProposal({ countryCode: event.target.value })}>
              <option value="">Seleccione el país</option>
              {countryCodes.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}
            </select>
          </ProposalField>
          <ProposalField field="icaoCode" label="Código ICAO" error={proposalError("icaoCode")}>
            <input {...proposalControl("icaoCode")} required maxLength={3} autoCapitalize="characters" value={proposal.icaoCode} onChange={(event) => changeProposal({ icaoCode: event.target.value.toUpperCase() })} />
          </ProposalField>
          <ProposalField field="iataCode" label="Código IATA (opcional)" error={proposalError("iataCode")}>
            <input {...proposalControl("iataCode")} maxLength={2} autoCapitalize="characters" value={proposal.iataCode} onChange={(event) => changeProposal({ iataCode: event.target.value.toUpperCase() })} />
          </ProposalField>
          <ProposalField field="websiteUrl" label="Sitio web oficial (opcional)" error={proposalError("websiteUrl")} wide>
            <input {...proposalControl("websiteUrl")} type="url" maxLength={512} inputMode="url" placeholder="https://" value={proposal.websiteUrl} onChange={(event) => changeProposal({ websiteUrl: event.target.value })} />
          </ProposalField>
          {listedMatch && <p className="access-representative__note" role="note">El código {listedMatch.icaoCode} corresponde a {listedMatch.name}, que ya figura en el listado. <button type="button" className="access-inline-link" onClick={() => { setAirlineId(listedMatch.id); toggleProposal(false); }}>Elegir {listedMatch.name}</button></p>}
        </div>}
        {airline && <div className="access-airline">
          <div className="access-airline__logo">{airline.logoUrl ? <Image src={mediaUrl(airline.logoUrl)!} alt={airline.logoUrl.includes('/reference-') ? `Referencia visual de ${airline.name}` : `Logo de ${airline.name}`} width={92} height={92} unoptimized /> : <span aria-label="Monograma de aerolínea">{airline.name.slice(0, 2)}</span>}<small>{airline.logoUrl?.includes('/reference-') ? "REFERENCIA AVIAM" : airline.logoUrl ? "LOGO" : "MONOGRAMA"}</small></div>
          <div className="access-airline__fields">
            <ReadOnlyField label="Aerolínea" value={airline.name} />
            <ReadOnlyField label="Razón social" value={airline.legalName ?? null} />
            <ReadOnlyField label="Región" value={airline.region} />
            <ReadOnlyField label="País" value={airline.countryCode ?? null} />
            <ReadOnlyField label="Código IATA" value={airline.iataCode ?? null} />
            <ReadOnlyField label="Código ICAO" value={airline.icaoCode ?? null} />
          </div>
          {airline.registrySource && <p className="access-airline__registry" role="note">✓ Verificada en registro público ({airline.registrySource}): el nombre y los códigos coinciden con una aerolínea en operación.</p>}
          <p className="access-airline__verification">{airline.isVerified ? "✓ Identidad verificada por AVIAM" : "Los datos sin fuente aparecen como «Sin dato confirmado»; Contratos verificará la identidad legal."}</p>
        </div>}
      </> : step === 3 ? <>
        <div className="access-panel__heading"><p>03 / REPRESENTANTE</p><h2>¿Quién presenta la solicitud?</h2><span>Ingrese los datos de la persona autorizada para representar a la aerolínea.</span></div>
        <form id="access-representative" className="access-representative" noValidate onSubmit={(event) => { event.preventDefault(); next(); }}>
          <FormField field="name" label="Nombre completo" error={fieldError("name")}>
            <input {...control("name")} required maxLength={160} autoComplete="name" value={representative.name} onChange={(event) => changeRepresentative({ name: event.target.value })} />
          </FormField>
          <FormField field="titleOption" label="Cargo" error={fieldError("titleOption")}>
            <select {...control("titleOption")} className="access-select" required autoComplete="organization-title" value={representative.titleOption} onChange={(event) => changeTitle(event.target.value)}>
              <option value="">Seleccione su cargo</option>
              {REPRESENTATIVE_TITLES.map((title) => <option key={title} value={title}>{title}</option>)}
            </select>
          </FormField>
          {representative.titleOption === TITLE_OTHER && <FormField field="titleCustom" label="Especifique su cargo" error={fieldError("titleCustom")}>
            <input {...control("titleCustom")} required maxLength={120} autoComplete="organization-title" value={representative.titleCustom} onChange={(event) => changeRepresentative({ titleCustom: event.target.value })} />
          </FormField>}
          <FormField field="email" label="Correo corporativo" error={fieldError("email")}>
            <input {...control("email")} required type="email" maxLength={256} autoComplete="email" value={representative.email} onChange={(event) => changeRepresentative({ email: event.target.value })} />
          </FormField>
          <FormField field="phone" label="Teléfono" error={fieldError("phone")}>
            <input {...control("phone")} required type="tel" maxLength={32} autoComplete="tel" inputMode="tel" placeholder="809-555-0100" value={representative.phone} onChange={(event) => changeRepresentative({ phone: event.target.value.replace(/[^+\d ().-]/g, "") })} />
            <small className="access-field-hint">República Dominicana: 10 dígitos (809, 829 o 849). Otros países: con su prefijo, p. ej. +34.</small>
          </FormField>
          <FormField field="nationalityCode" label={representative.documentType === "Passport" ? "Nacionalidad del pasaporte" : "Nacionalidad"} error={fieldError("nationalityCode")}>
            <select {...control("nationalityCode")} className="access-select" required={representative.documentType === "Passport"} value={representative.nationalityCode} onChange={(event) => changeRepresentative({ nationalityCode: event.target.value })}><option value="">{representative.documentType === "Passport" ? "Seleccione el país del pasaporte" : "Seleccione si desea indicarla"}</option>{countryCodes.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}</select>
          </FormField>
          <FormField field="documentType" label="Tipo de documento" error={fieldError("documentType")}>
            <select {...control("documentType")} className="access-select" required value={representative.documentType} onChange={(event) => changeRepresentative({ documentType: event.target.value, documentNumber: formatDocumentNumber(event.target.value, representative.documentNumber) })}><option value="">Seleccione</option><option value="NationalId">Cédula</option><option value="Passport">Pasaporte</option></select>
          </FormField>
          <FormField field="documentNumber" label="Número de documento" error={fieldError("documentNumber")}>
            <input {...control("documentNumber")} required maxLength={13} autoCapitalize="characters" inputMode={representative.documentType === "NationalId" ? "numeric" : "text"} placeholder={documentPlaceholder} value={representative.documentNumber} onChange={(event) => changeRepresentative({ documentNumber: formatDocumentNumber(representative.documentType, event.target.value) })} />
            {documentPlaceholder && <small className="access-field-hint">Formato: {documentPlaceholder}</small>}
            {documentRequirements.length > 0 && <ul className="access-doc-checklist" aria-live="polite" aria-label="Requisitos del número de documento">
              {documentRequirements.map((item) => <li key={item.label.replace(/ \(.*\)$/, "")} data-met={item.met}>
                <span aria-hidden="true">{item.met ? "✓" : "○"}</span>{item.label}<span className="access-visually-hidden">{item.met ? " (cumplido)" : " (pendiente)"}</span></li>)}
            </ul>}
          </FormField>
          <FormField field="address" label="Dirección (opcional)" error={fieldError("address")} wide>
            <input {...control("address")} maxLength={250} autoComplete="street-address" value={representative.address} onChange={(event) => changeRepresentative({ address: event.target.value })} />
          </FormField>
          <FormField field="country" label="País" error={fieldError("country")}>
            <select {...control("country")} className="access-select" required autoComplete="country" value={representative.country} onChange={(event) => changeCountry(event.target.value)}>
              <option value="">Seleccione su país</option>
              {countryCodes.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}
            </select>
          </FormField>
          <FormField field="province" label="Provincia / Estado / Región" error={divisionsError ? undefined : fieldError("province")}>
            <select {...control("province")} className="access-select" required={Boolean(divisions?.length)} disabled={!divisions?.length} value={representative.province} onChange={(event) => changeProvince(event.target.value)}>
              <option value="">{!representative.country ? "Seleccione primero el país" : divisionsError ? "No disponible" : divisions === null ? "Cargando…" : divisions.length === 0 ? "No aplica" : "Seleccione una opción"}</option>
              {divisions?.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </select>
            {divisionsError && <span className="access-field-error" role="alert">No se pudieron cargar las divisiones de este país. <button type="button" onClick={() => fetchDivisions(representative.country)}>Reintentar</button></span>}
          </FormField>
          <FormField field="municipality" label="Municipio / Ciudad" error={fieldError("municipality")}>
            <select {...control("municipality")} className="access-select" required={Boolean(division?.cities.length)} disabled={!division?.cities.length} value={representative.municipality} onChange={(event) => changeRepresentative({ municipality: event.target.value, district: "" })}>
              <option value="">{!division ? "Seleccione primero la provincia" : division.cities.length === 0 ? "No aplica" : "Seleccione una opción"}</option>
              {division?.cities.map((city) => <option key={city} value={city}>{city}</option>)}
            </select>
          </FormField>
          {districts.length > 0 && <FormField field="district" label="Distrito municipal (opcional)" error={fieldError("district")}>
            <select {...control("district")} className="access-select" value={representative.district} onChange={(event) => changeRepresentative({ district: event.target.value })}>
              <option value="">Cabecera del municipio</option>
              {districts.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </FormField>}
          <div className="access-authority-field">
            <label className="access-authority"><input {...control("authorityDeclared")} required type="checkbox" checked={representative.authorityDeclared} onChange={(event) => changeRepresentative({ authorityDeclared: event.target.checked })} /><span>Declaro que estoy autorizado para presentar esta solicitud en nombre de {airlineName}.</span></label>
            {fieldError("authorityDeclared") && <p className="access-field-error" id={`${fieldId("authorityDeclared")}-error`}>{fieldError("authorityDeclared")}</p>}
          </div>
          <p className="access-representative__note">Servicios solicitados: {catalog?.services.filter((service) => selected.includes(service.id)).map((service) => service.name).join(" · ")}</p>
        </form>
      </> : <>
        <div className="access-panel__heading"><p>04 / CONFIRMACIÓN</p><h2>Revise su solicitud.</h2><span>Contratos recibirá exactamente estos datos al confirmar el envío.</span></div>
        <div className="access-summary">
          <section><div className="access-summary__header"><h3>Servicios solicitados</h3><button type="button" onClick={() => setStep(1)}>Editar servicios</button></div><ul>{catalog?.services.filter((service) => selected.includes(service.id)).map((service) => <li key={service.id}>{service.name}</li>)}</ul></section>
          <section><div className="access-summary__header"><h3>Aerolínea</h3><button type="button" onClick={() => setStep(2)}>Editar aerolínea</button></div><p>{airlineName}</p>{proposing
            ? <small>No figura en el listado · {countryName(proposal.countryCode)} · ICAO {proposal.icaoCode.trim().toUpperCase()} · {proposal.iataCode.trim() ? `IATA ${proposal.iataCode.trim().toUpperCase()}` : "Sin IATA"}{proposal.websiteUrl.trim() ? ` · ${proposal.websiteUrl.trim()}` : ""}</small>
            : <small>{airline?.legalName ?? "Sin razón social confirmada"} · {airline?.countryCode ?? "Sin país confirmado"}</small>}</section>
          <section><div className="access-summary__header"><h3>Representante</h3><button type="button" onClick={() => setStep(3)}>Editar representante</button></div><dl>
            <div><dt>Nombre y cargo</dt><dd>{representative.name} · {effectiveTitle(representative)}</dd></div>
            <div><dt>Contacto</dt><dd>{representative.email} · {representative.phone}</dd></div>
            {representative.nationalityCode && <div><dt>Nacionalidad</dt><dd>{countryName(representative.nationalityCode)}</dd></div>}
            {representative.documentType && <div><dt>Documento</dt><dd>{DOCUMENT_LABELS[representative.documentType] ?? representative.documentType} · {representative.documentNumber}</dd></div>}
            {[representative.address, location.district, location.municipality, location.province, location.country].some(Boolean) && <div><dt>Dirección</dt><dd>{[representative.address, location.district && `D. M. ${location.district}`, location.municipality, location.province, location.country].filter(Boolean).join(", ")}</dd></div>}
          </dl><small>Declaración de representación aceptada</small></section>
        </div>
      </>}
      {catalogError && <><p className="access-error" role="alert">{catalogError}</p>
        <button type="button" className="access-back" onClick={() => { void reload(); }}>Reintentar catálogo</button></>}
      {error && <p className="access-error" role="alert">{error}</p>}
      <div className="access-panel__footer">
        {step > 1 ? <button type="button" className="access-back" onClick={() => { setStep(step - 1); setError(""); }}>← Volver</button> : <span>AVIAM × ELEVANT</span>}
        {step < 4 ? <button type="button" className="access-next" onClick={next} disabled={loading}>Continuar <span aria-hidden="true">↗</span></button> : <button type="button" onClick={() => { void submit(); }} className="access-next" disabled={busy}>{busy ? "Enviando…" : "Enviar solicitud"} <span aria-hidden="true">↗</span></button>}
      </div>
    </section>
  </div>;
}

function FormField({ field, label, error, wide, children }: {
  field: RepresentativeField; label: string; error?: string; wide?: boolean; children: ReactNode;
}) {
  return <div className={wide ? "access-field access-representative__wide" : "access-field"}>
    <label htmlFor={fieldId(field)}>{label}</label>
    {children}
    {error && <p className="access-field-error" id={`${fieldId(field)}-error`}>{error}</p>}
  </div>;
}

function ProposalField({ field, label, error, wide, children }: {
  field: AirlineProposalField; label: string; error?: string; wide?: boolean; children: ReactNode;
}) {
  const hint = PROPOSAL_HINTS[field];
  return <div className={wide ? "access-field access-representative__wide" : "access-field"}>
    <label htmlFor={proposalId(field)}>{label}</label>
    {children}
    {hint && <small className="access-field-hint" id={`${proposalId(field)}-hint`}>{hint}</small>}
    {error && <p className="access-field-error" id={`${proposalId(field)}-error`}>{error}</p>}
  </div>;
}

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return <label>{label}<input readOnly value={value ?? "Sin dato confirmado"} aria-label={label} /></label>;
}
