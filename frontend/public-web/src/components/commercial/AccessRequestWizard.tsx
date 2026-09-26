"use client";

import { HubConnectionBuilder, HubConnectionState } from "@microsoft/signalr";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Service = { id: string; name: string; description: string; imageUrl: string | null; videoUrl: string | null; displayOrder: number };
type Airline = { id: string; name: string; region: string; legalName: string | null; countryCode: string | null; iataCode: string | null; icaoCode: string | null; logoUrl: string | null; isVerified: boolean };
type Catalog = { services: Service[]; airlines: Airline[] };
type Representative = { name: string; title: string; email: string; phone: string; authorityDeclared: boolean };
const emptyRepresentative: Representative = { name: "", title: "", email: "", phone: "", authorityDeclared: false };
const apiOrigin = process.env.NEXT_PUBLIC_ELEVANT_API_URL?.replace(/\/$/, "");

export function AccessRequestWizard() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [airlineId, setAirlineId] = useState("");
  const [representative, setRepresentative] = useState(emptyRepresentative);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const requestId = useRef<string | null>(null);
  const carousel = useRef<HTMLDivElement>(null);
  const airline = catalog?.airlines.find((item) => item.id === airlineId);

  const reload = useCallback(async () => {
    if (!apiOrigin) { setError("El catálogo comercial aún no está configurado."); setLoading(false); return; }
    try {
      const response = await fetch(`${apiOrigin}/api/v1/public/commercial-catalog`, { cache: "no-store" });
      if (!response.ok) throw new Error("No se pudo cargar el catálogo.");
      const data = await response.json() as Catalog;
      setCatalog(data);
      setSelected((current) => current.filter((id) => data.services.some((service) => service.id === id)));
      setAirlineId((current) => data.airlines.some((item) => item.id === current) ? current : "");
      setError("");
    } catch { setError("No se pudo cargar el catálogo. Intente nuevamente."); }
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
    setError(""); setStep((current) => Math.min(3, current + 1));
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apiOrigin || !airline || !selected.length) return;
    setBusy(true); setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch(`${apiOrigin}/api/v1/public/commercial-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: requestId.current, airlineProfileId: airlineId,
          serviceIds: selected, representativeName: representative.name.trim(),
          representativeTitle: representative.title.trim(), representativeEmail: representative.email.trim(),
          representativePhone: representative.phone.trim(), authorityDeclared: representative.authorityDeclared }),
      });
      if (!response.ok) {
        setError(response.status === 409 ? "El catálogo cambió o la solicitud fue modificada. Revise los datos y vuelva a enviarla." :
          "No se pudo enviar la solicitud. Revise los datos o vuelva a intentarlo.");
        return;
      }
      const result = await response.json() as { reference: string };
      setReference(result.reference);
    } catch { setError("No hay conexión con el servidor. Vuelva a intentarlo."); }
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
      <p>Elija los servicios que necesita, confirme la aerolínea y registre a su representante. El equipo de Contratos revisará la solicitud dentro de ELEVANT.</p>
      <div className="access-intro__rule" />
      <ol className="access-steps" aria-label="Pasos de la solicitud">
        {["Seleccionar servicios", "Información de la aerolínea", "Representante legal"].map((label, index) =>
          <li key={label} aria-current={step === index + 1 ? "step" : undefined} data-active={step === index + 1} data-done={step > index + 1}>
            <span>0{index + 1}</span><span>{label}</span><span aria-hidden="true">{step > index + 1 ? "✓" : "↗"}</span>
          </li>)}
      </ol>
      <p className="access-intro__foot">OPERACIÓN CONECTADA · DECISIONES VERIFICABLES</p>
    </aside>

    <section className="access-panel" aria-live="polite">
      <div className="access-panel__top"><span>PASO 0{step} / 03</span><span>ACCESO COMERCIAL</span></div>
      {loading ? <p className="access-loading">Cargando servicios y aerolíneas…</p> : step === 1 ? <>
        <div className="access-panel__heading"><p>01 / SERVICIOS</p><h2>¿Qué necesita su operación?</h2><span>Seleccione uno o varios servicios de rampa.</span></div>
        <div className="access-carousel__controls"><span>{selected.length} SELECCIONADOS</span><div><button type="button" aria-label="Ver servicios anteriores" onClick={() => carousel.current?.scrollBy({ left: -390, behavior: "smooth" })}>←</button><button type="button" aria-label="Ver servicios siguientes" onClick={() => carousel.current?.scrollBy({ left: 390, behavior: "smooth" })}>→</button></div></div>
        <div className="access-carousel" ref={carousel} aria-label="Servicios disponibles">
          {catalog?.services.map((service, index) => <article className="access-service" key={service.id} data-selected={selected.includes(service.id)}>
            <div className="access-service__media">
              {service.videoUrl ? <video controls playsInline poster={service.imageUrl ?? undefined} src={service.videoUrl} aria-label={`Video de ${service.name}`} /> :
                service.imageUrl ? <div className="access-service__image" style={{ backgroundImage: `url(${service.imageUrl})` }} role="img" aria-label={service.name} /> : <div className="access-service__placeholder" />}
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
          <div className="access-airline__logo">{airline.logoUrl ? <img src={airline.logoUrl} alt={`Logo de ${airline.name}`} /> : <span aria-label="Logo pendiente de verificación">{airline.name.slice(0, 2)}</span>}<small>{airline.logoUrl ? "LOGO" : "LOGO POR VERIFICAR"}</small></div>
          <div className="access-airline__fields">
            <ReadOnlyField label="Aerolínea" value={airline.name} />
            <ReadOnlyField label="Razón social" value={airline.legalName} />
            <ReadOnlyField label="Región" value={airline.region} />
            <ReadOnlyField label="País" value={airline.countryCode} />
            <ReadOnlyField label="Código IATA" value={airline.iataCode} />
            <ReadOnlyField label="Código ICAO" value={airline.icaoCode} />
          </div>
          <p className="access-airline__verification">{airline.isVerified ? "✓ Identidad verificada por AVIAM" : "La identidad legal y el logo están pendientes de verificación por Contratos."}</p>
        </div>}
      </> : <>
        <div className="access-panel__heading"><p>03 / REPRESENTANTE</p><h2>¿Quién presenta la solicitud?</h2><span>Ingrese los datos de la persona autorizada para representar a la aerolínea.</span></div>
        <form id="access-submit" className="access-representative" onSubmit={submit}>
          <label>Nombre completo<input required maxLength={160} autoComplete="name" value={representative.name} onChange={(event) => changeRepresentative("name", event.target.value)} /></label>
          <label>Cargo<input required maxLength={120} autoComplete="organization-title" value={representative.title} onChange={(event) => changeRepresentative("title", event.target.value)} /></label>
          <label>Correo corporativo<input required type="email" maxLength={256} autoComplete="email" value={representative.email} onChange={(event) => changeRepresentative("email", event.target.value)} /></label>
          <label>Teléfono<input required type="tel" maxLength={32} autoComplete="tel" value={representative.phone} onChange={(event) => changeRepresentative("phone", event.target.value)} /></label>
          <label className="access-authority"><input required type="checkbox" checked={representative.authorityDeclared} onChange={(event) => changeRepresentative("authorityDeclared", event.target.checked)} /><span>Declaro que estoy autorizado para presentar esta solicitud en nombre de {airline?.name}.</span></label>
          <p className="access-representative__note">Servicios solicitados: {catalog?.services.filter((service) => selected.includes(service.id)).map((service) => service.name).join(" · ")}</p>
        </form>
      </>}
      {error && <p className="access-error" role="alert">{error}</p>}
      <div className="access-panel__footer">
        {step > 1 ? <button type="button" className="access-back" onClick={() => { setStep(step - 1); setError(""); }}>← Volver</button> : <span>AVIAM × ELEVANT</span>}
        {step < 3 ? <button type="button" className="access-next" onClick={next} disabled={loading}>Continuar <span aria-hidden="true">↗</span></button> : <button type="submit" form="access-submit" className="access-next" disabled={busy}>{busy ? "Enviando…" : "Enviar solicitud"} <span aria-hidden="true">↗</span></button>}
      </div>
    </section>
  </div>;
}

function ReadOnlyField({ label, value }: { label: string; value: string | null }) {
  return <label>{label}<input readOnly value={value ?? "Pendiente de verificación"} aria-label={label} /></label>;
}
