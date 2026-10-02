"use client";

import Image from "next/image";

import { HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";
import { ElevantApiError, type PublicCommercialCatalog } from "@elevant/api-client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicWebApiClient } from "@/lib/elevant-api";

type Catalog = PublicCommercialCatalog;
type Representative = {
  name: string; title: string; email: string; phone: string; authorityDeclared: boolean;
  nationalityCode: string; address: string; country: string; province: string;
  municipality: string; documentType: string; documentNumber: string;
};
const emptyRepresentative: Representative = {
  name: "", title: "", email: "", phone: "", authorityDeclared: false,
  nationalityCode: "", address: "", country: "", province: "",
  municipality: "", documentType: "", documentNumber: "",
};
const nationalityNames = new Intl.DisplayNames(["es"], { type: "region" });
const nonCountryRegions = new Set("AC AN BU CP CQ CS DD DG DY EA EU EZ FX HV IC NH QO RH SU TA TP UK UN VD XA XB YD YU ZR ZZ".split(" "));
const nationalityCodes = Array.from({ length: 26 * 26 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26), 65 + index % 26))
  .filter((code) => !nonCountryRegions.has(code) && nationalityNames.of(code) !== code)
  .sort((left, right) => (nationalityNames.of(left) ?? left).localeCompare(
    nationalityNames.of(right) ?? right, "es"));
const apiOrigin = process.env.NEXT_PUBLIC_ELEVANT_API_URL?.replace(/\/$/, "");
const mediaUrl = (path: string | null | undefined) => path?.startsWith("/api/v1/media/") ? `${apiOrigin}${path}` : path ?? undefined;

export function AccessRequestWizard() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [airlineId, setAirlineId] = useState("");
  const [representative, setRepresentative] = useState(emptyRepresentative);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [reference, setReference] = useState("");
  const requestId = useRef<string | null>(null);
  const carousel = useRef<HTMLDivElement>(null);
  const airline = catalog?.airlines.find((item) => item.id === airlineId);

  const reload = useCallback(async () => {
    if (!apiOrigin) { setCatalogError("El catálogo comercial aún no está configurado."); setLoading(false); return; }
    try {
      const data = await createPublicWebApiClient().getPublicCommercialCatalog({ cache: "no-store" });
      setCatalog(data);
      setSelected((current) => {
        const retained = current.filter((id) => data.services.some((service) => service.id === id));
        if (retained.length !== current.length) requestId.current = null;
        return retained;
      });
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
  }, []);

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

  const changeRepresentative = (field: keyof Representative, value: string | boolean) => {
    setRepresentative((current) => ({ ...current, [field]: value }));
    requestId.current = null;
    setError("");
  };
  const toggleService = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    requestId.current = null;
    setError("");
  };
  const next = () => {
    if (step === 1 && selected.length === 0) { setError("Seleccione al menos un servicio para continuar."); return; }
    if (step === 2 && !airlineId) { setError("Seleccione la aerolínea que representa."); return; }
    if (step === 3) {
      const form = document.getElementById("access-representative") as HTMLFormElement | null;
      const invalid = Array.from(form?.elements ?? []).find((element) =>
        element instanceof HTMLInputElement && !element.checkValidity());
      if (invalid instanceof HTMLInputElement) {
        invalid.focus();
        setError(invalid.validity.valueMissing ? "Complete los campos obligatorios y confirme su autorización." :
          "Revise el formato del campo señalado antes de continuar.");
        return;
      }
      if (Boolean(representative.documentType) !== Boolean(representative.documentNumber.trim())) {
        setError("Si indica un documento, complete su tipo y número."); return;
      }
      const digits = representative.phone.replace(/\D/g, "");
      if (!representative.phone.trim().startsWith("+") || digits.length < 8 || digits.length > 15) {
        setError("Ingrese un teléfono internacional con prefijo y entre 8 y 15 dígitos."); return;
      }
    }
    setError(""); setStep((current) => Math.min(4, current + 1));
  };
  const submit = async () => {
    if (!apiOrigin || !airline || !selected.length) return;
    setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await createPublicWebApiClient().submitCommercialRequest({
        requestId: requestId.current, airlineProfileId: airlineId,
        serviceIds: selected, representativeName: representative.name.trim(),
        representativeTitle: representative.title.trim(), representativeEmail: representative.email.trim(),
        representativePhone: representative.phone.trim(), authorityDeclared: representative.authorityDeclared,
        representativeNationalityCode: representative.nationalityCode || null,
        representativeAddress: representative.address.trim() || null,
        representativeCountry: representative.country.trim() || null,
        representativeProvince: representative.province.trim() || null,
        representativeMunicipality: representative.municipality.trim() || null,
        representativeDocumentType: representative.documentType || null,
        representativeDocumentNumber: representative.documentNumber.trim() || null,
      });
      setReference(result.reference);
    } catch (failure) {
      if (failure instanceof ElevantApiError && [404, 409].includes(failure.status))
        setError("El catálogo cambió o la solicitud fue modificada. Revise los datos y vuelva a enviarla.");
      else if (failure instanceof ElevantApiError && failure.status === 429)
        setError("Demasiados intentos. Espere un momento antes de reintentar.");
      else
        setError("No se pudo confirmar la recepción. Revise la conexión y reintente sin modificar los datos.");
    }
    finally { setBusy(false); }
  };

  if (reference) return <section className="access-complete" role="status">
    <p className="access-kicker">SOLICITUD RECIBIDA / AVIAM</p>
    <h1>Su solicitud ya está en revisión.</h1>
    <p>Contratos verificará la información de {airline?.name ?? "su aerolínea"} y los servicios seleccionados. Conserve esta referencia para cualquier consulta.</p>
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
      {loading ? <p className="access-loading">Cargando servicios y aerolíneas…</p> : step === 1 ? <>
        <div className="access-panel__heading"><p>01 / SERVICIOS</p><h2>¿Qué necesita su operación?</h2><span>Seleccione uno o varios servicios de rampa.</span></div>
        <div className="access-carousel__controls"><span>{selected.length} SELECCIONADOS</span><div><button type="button" aria-label="Ver servicios anteriores" onClick={() => carousel.current?.scrollBy({ left: -390, behavior: "smooth" })}>←</button><button type="button" aria-label="Ver servicios siguientes" onClick={() => carousel.current?.scrollBy({ left: 390, behavior: "smooth" })}>→</button></div></div>
        <div className="access-carousel" ref={carousel} aria-label="Servicios disponibles">
          {catalog?.services.map((service, index) => <article className="access-service" key={service.id} data-selected={selected.includes(service.id)}>
            <div className="access-service__media">
              {service.videoUrl ? <video controls playsInline poster={mediaUrl(service.imageUrl)} src={mediaUrl(service.videoUrl)} aria-label={`Video de ${service.name}`} /> :
                service.imageUrl ? <div className="access-service__image" style={{ backgroundImage: `url(${mediaUrl(service.imageUrl)})` }} role="img" aria-label={service.name} /> : <div className="access-service__placeholder" />}
              <span>0{index + 1} / AVIAM</span>
            </div>
            <div className="access-service__body"><h3>{service.name}</h3><p>{service.description}</p>
              <button type="button" onClick={() => toggleService(service.id)} aria-pressed={selected.includes(service.id)}>{selected.includes(service.id) ? "Seleccionado ✓" : "Añadir servicio +"}</button>
            </div>
          </article>)}
          {catalog?.services.length === 0 && <p>No hay servicios publicados por el momento.</p>}
        </div>
      </> : step === 2 ? <>
        <div className="access-panel__heading"><p>02 / AEROLÍNEA</p><h2>¿A cuál aerolínea representa?</h2><span>La ficha se carga desde el catálogo de AVIAM y se revisará antes de aprobar el contrato.</span></div>
        <label className="access-label" htmlFor="airline-select">Seleccione una aerolínea</label>
        <select id="airline-select" className="access-select" value={airlineId} onChange={(event) => { setAirlineId(event.target.value); requestId.current = null; setError(""); }} required>
          <option value="">Buscar en el listado de aerolíneas</option>
          {[...new Set(catalog?.airlines.map((item) => item.region))].map((region) => <optgroup key={region} label={region}>{catalog?.airlines.filter((item) => item.region === region).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</optgroup>)}
        </select>
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
          <p className="access-airline__verification">{airline.isVerified ? "✓ Identidad verificada por AVIAM" : "Los datos sin fuente aparecen como «Sin dato confirmado»; Contratos verificará la identidad legal."}</p>
        </div>}
      </> : step === 3 ? <>
        <div className="access-panel__heading"><p>03 / REPRESENTANTE</p><h2>¿Quién presenta la solicitud?</h2><span>Ingrese los datos de la persona autorizada para representar a la aerolínea.</span></div>
        <form id="access-representative" className="access-representative" noValidate onSubmit={(event) => { event.preventDefault(); next(); }}>
          <label>Nombre completo<input required maxLength={160} autoComplete="name" value={representative.name} onChange={(event) => changeRepresentative("name", event.target.value)} /></label>
          <label>Cargo<input required maxLength={120} autoComplete="organization-title" value={representative.title} onChange={(event) => changeRepresentative("title", event.target.value)} /></label>
          <label>Correo corporativo<input required type="email" maxLength={256} autoComplete="email" value={representative.email} onChange={(event) => changeRepresentative("email", event.target.value)} /></label>
          <label>Teléfono<input required type="tel" maxLength={32} autoComplete="tel" inputMode="tel" placeholder="+1 809 555 0100" pattern="\+[0-9 ()-]{8,31}" value={representative.phone} onChange={(event) => changeRepresentative("phone", event.target.value.replace(/[^+\d ()-]/g, ""))} /></label>
          <label>Nacionalidad (opcional)<select className="access-select" value={representative.nationalityCode} onChange={(event) => changeRepresentative("nationalityCode", event.target.value)}><option value="">Seleccione si desea indicarla</option>{nationalityCodes.map((code) => <option key={code} value={code}>{nationalityNames.of(code)}</option>)}</select></label>
          <label>Tipo de documento (opcional)<select className="access-select" value={representative.documentType} onChange={(event) => changeRepresentative("documentType", event.target.value)}><option value="">Seleccione</option><option value="NationalId">Documento nacional</option><option value="Passport">Pasaporte</option><option value="Other">Otro</option></select></label>
          <label>Número de documento (opcional)<input maxLength={40} minLength={3} pattern="[A-Za-z0-9 /-]{3,40}" value={representative.documentNumber} onChange={(event) => changeRepresentative("documentNumber", event.target.value.replace(/[^A-Za-z0-9 /-]/g, ""))} /></label>
          <label className="access-representative__wide">Dirección (opcional)<input maxLength={250} autoComplete="street-address" value={representative.address} onChange={(event) => changeRepresentative("address", event.target.value)} /></label>
          <label>País (opcional)<input maxLength={80} autoComplete="country-name" value={representative.country} onChange={(event) => changeRepresentative("country", event.target.value)} /></label>
          <label>Provincia (opcional)<input maxLength={80} autoComplete="address-level1" value={representative.province} onChange={(event) => changeRepresentative("province", event.target.value)} /></label>
          <label>Municipio (opcional)<input maxLength={80} autoComplete="address-level2" value={representative.municipality} onChange={(event) => changeRepresentative("municipality", event.target.value)} /></label>
          <label className="access-authority"><input required type="checkbox" checked={representative.authorityDeclared} onChange={(event) => changeRepresentative("authorityDeclared", event.target.checked)} /><span>Declaro que estoy autorizado para presentar esta solicitud en nombre de {airline?.name}.</span></label>
          <p className="access-representative__note">Servicios solicitados: {catalog?.services.filter((service) => selected.includes(service.id)).map((service) => service.name).join(" · ")}</p>
        </form>
      </> : <>
        <div className="access-panel__heading"><p>04 / CONFIRMACIÓN</p><h2>Revise su solicitud.</h2><span>Contratos recibirá exactamente estos datos al confirmar el envío.</span></div>
        <div className="access-summary">
          <section><div className="access-summary__header"><h3>Servicios solicitados</h3><button type="button" onClick={() => setStep(1)}>Editar servicios</button></div><ul>{catalog?.services.filter((service) => selected.includes(service.id)).map((service) => <li key={service.id}>{service.name}</li>)}</ul></section>
          <section><div className="access-summary__header"><h3>Aerolínea</h3><button type="button" onClick={() => setStep(2)}>Editar aerolínea</button></div><p>{airline?.name}</p><small>{airline?.legalName ?? "Sin razón social confirmada"} · {airline?.countryCode ?? "Sin país confirmado"}</small></section>
          <section><div className="access-summary__header"><h3>Representante</h3><button type="button" onClick={() => setStep(3)}>Editar representante</button></div><dl>
            <div><dt>Nombre y cargo</dt><dd>{representative.name} · {representative.title}</dd></div>
            <div><dt>Contacto</dt><dd>{representative.email} · {representative.phone}</dd></div>
            {representative.nationalityCode && <div><dt>Nacionalidad</dt><dd>{nationalityNames.of(representative.nationalityCode)}</dd></div>}
            {representative.documentType && <div><dt>Documento</dt><dd>{representative.documentType} · {representative.documentNumber}</dd></div>}
            {[representative.address, representative.municipality, representative.province, representative.country].some(Boolean) && <div><dt>Dirección</dt><dd>{[representative.address, representative.municipality, representative.province, representative.country].filter(Boolean).join(", ")}</dd></div>}
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

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return <label>{label}<input readOnly value={value ?? "Sin dato confirmado"} aria-label={label} /></label>;
}
