"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AirlinePermitData, ContractTimelineData } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { usePortalCapabilities } from "@/components/auth/usePortalCapabilities";
import { businessToday } from "@/lib/business-day";
import { permitProblem } from "@/lib/permit-problems";
import styles from "./AirlinePortalPage.module.css";

const KINDS: Record<string, string> = {
  OperatingPermit: "Permiso de operación (JAC)",
  AirOperatorCertificate: "Certificado de explotador (IDAC / AOC)",
  Insurance: "Póliza de seguro",
  Other: "Otro documento",
};
const VALIDITY: Record<string, string> = { Current: "Vigente", Expiring: "Vence en 30 días o menos", Expired: "Vencido" };
const REVIEW: Record<string, string> = { Submitted: "En revisión por AVIAM", Verified: "Verificado por AVIAM", Rejected: "Rechazado",
  Revoked: "Verificación revocada por AVIAM" };
/** 2-F: permits expire by AVIAM's business day (America/Santo_Domingo), not the UTC day of the browser. */
const today = () => businessToday();
const EMPTY = { kind: "OperatingPermit", number: "", issuer: "", issuedOn: "", expiresOn: "" };

/** One submission the airline is trying to send: its key, what it sends and the scan already uploaded for it. */
interface PermitIntent { signature: string; key: string; documentUrl: string | null }

/**
 * Permit dossier of the airline (ADR-0024): what it submitted, whether AVIAM verified it and when
 * it expires. A verified, current operating permit is needed to activate and keep a contract.
 */
export function AirlinePermitsSection() {
  const { getPermits, submitPermit, uploadPermitDocument } = useAirlineSession();
  // 2-N20: only the airline's representatives and signers submit permits; while unknown the form stays.
  const capabilities = usePortalCapabilities();
  const canSubmit = capabilities.status !== "ready" || capabilities.me.canSign;
  const [permits, setPermits] = useState<AirlinePermitData[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // 2-N09: the key of an uncertain attempt is reused with the same data and the same uploaded scan, so a retry
  // answers the permit the first attempt created instead of a duplicate.
  const intent = useRef<PermitIntent | null>(null);

  const [revision, setRevision] = useState(0);
  const load = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    getPermits().then(rows => { if (active) { setPermits(rows); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [getPermits, revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.number.trim() || !form.issuer.trim() || !form.issuedOn || !form.expiresOn) {
      setMessage({ kind: "error", text: "Complete el tipo, número, emisor y las dos fechas." });
      return;
    }
    if (form.expiresOn < today()) { setMessage({ kind: "error", text: "El permiso ya está vencido." }); return; }
    const signature = JSON.stringify([form, file ? [file.name, file.size, file.lastModified] : null]);
    if (intent.current?.signature !== signature)
      intent.current = { signature, key: crypto.randomUUID(), documentUrl: null };
    const current = intent.current;
    setBusy(true); setMessage(null);
    try {
      if (file && !current.documentUrl) current.documentUrl = await uploadPermitDocument(file);
      await submitPermit({ kind: form.kind, number: form.number, issuer: form.issuer, issuedOn: form.issuedOn,
        expiresOn: form.expiresOn, documentUrl: current.documentUrl }, current.key);
      intent.current = null;
      setForm(EMPTY); setFile(null);
      setMessage({ kind: "ok", text: "Permiso enviado. AVIAM lo verificará y verá el resultado aquí." });
      load();
    } catch (error) {
      const failure = permitProblem(error);
      // An answer settles the intent; only an uncertain result is retried with the same key and scan.
      if (!failure.retry) intent.current = null;
      setMessage({ kind: "error", text: failure.text });
    }
    finally { setBusy(false); }
  }

  const usable = permits?.some(item => item.kind === "OperatingPermit" && item.review === "Verified" && item.validity !== "Expired");
  return <section className={styles.panel} aria-labelledby="permits-heading">
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>Expediente</span><h2 id="permits-heading">Permisos de la aerolínea</h2></div>
      <strong className={usable ? styles.permitOk : styles.permitMissing}>{usable ? "Permiso de operación vigente" : "Falta un permiso de operación verificado"}</strong></div>
    <p className={styles.note}>Sin un permiso de operación verificado y vigente el contrato no se activa, y si vence se suspende hasta que AVIAM verifique uno nuevo.</p>
    {!permits && !failed && <p role="status">Cargando permisos…</p>}
    {failed && <p role="alert">No se pudieron cargar los permisos. <button type="button" onClick={load}>Reintentar</button></p>}
    {permits && permits.length === 0 && <p className={styles.empty}>Todavía no ha enviado permisos.</p>}
    {permits && permits.length > 0 && <ul className={styles.draftComments} aria-label="Permisos enviados">
      {permits.map(permit => <li key={permit.id}>
        <strong>{KINDS[permit.kind] ?? permit.kind} · {permit.number}</strong>
        <p>{permit.issuer} · vence el {permit.expiresOn} · {VALIDITY[permit.validity] ?? permit.validity} · {REVIEW[permit.review] ?? permit.review}</p>
        {permit.reviewNote && permit.review !== "Revoked" && <small>Nota de AVIAM: {permit.reviewNote}</small>}
        {permit.review === "Revoked" && <small>AVIAM revocó la verificación de este permiso{permit.revocationReason
          ? `. Motivo: ${permit.revocationReason}` : "."} Envíe un documento válido para que cuente de nuevo.</small>}
      </li>)}
    </ul>}
    {!canSubmit && <p className={styles.note}>Solo los representantes y los firmantes de su aerolínea envían
      permisos. Pida a su representante que lo marque como firmante en «Perfil».</p>}
    {canSubmit && <form onSubmit={submit} noValidate className={styles.draftCommentForm} aria-label="Enviar un permiso">
      <label htmlFor="permit-kind">Tipo de documento</label>
      <select id="permit-kind" value={form.kind} onChange={event => setForm(current => ({ ...current, kind: event.target.value }))}>
        {Object.entries(KINDS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label htmlFor="permit-number">Número</label>
      <input id="permit-number" maxLength={60} value={form.number} onChange={event => setForm(current => ({ ...current, number: event.target.value }))} />
      <label htmlFor="permit-issuer">Emisor</label>
      <input id="permit-issuer" maxLength={120} value={form.issuer} onChange={event => setForm(current => ({ ...current, issuer: event.target.value }))} />
      <label htmlFor="permit-issued">Fecha de emisión</label>
      <input id="permit-issued" type="date" max={today()} value={form.issuedOn} onChange={event => setForm(current => ({ ...current, issuedOn: event.target.value }))} />
      <label htmlFor="permit-expires">Fecha de vencimiento</label>
      <input id="permit-expires" type="date" min={today()} value={form.expiresOn} onChange={event => setForm(current => ({ ...current, expiresOn: event.target.value }))} />
      <label htmlFor="permit-file">Documento escaneado (opcional: PDF, JPG o PNG, hasta 8 MB)</label>
      <input id="permit-file" type="file" accept="application/pdf,image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0] ?? null)} />
      <button type="submit" disabled={busy}>{busy ? "Enviando…" : "Enviar permiso"}</button>
      {message && <p role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
    </form>}
  </section>;
}

const ENTRY: Record<string, string> = { upcoming: "Próximamente" };

/** Chronological history of the contract, from the request to the last change (ADR-0024). */
export function ContractTimeline({ versionId }: { versionId: string }) {
  const { getContractTimeline } = useAirlineSession();
  const [open, setOpen] = useState(false);
  const [timeline, setTimeline] = useState<ContractTimelineData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || timeline) return;
    let active = true;
    getContractTimeline(versionId).then(result => { if (active) setTimeline(result); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [getContractTimeline, open, timeline, versionId]);

  return <div className={styles.contractVersion}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Ocultar línea de tiempo" : "Ver línea de tiempo del contrato"}</button>
    {open && failed && <p role="alert">No se pudo cargar la línea de tiempo.</p>}
    {open && !timeline && !failed && <p role="status">Cargando línea de tiempo…</p>}
    {open && timeline && <ol className={styles.timeline} aria-label={`Línea de tiempo de ${timeline.contractCode}`}>
      {timeline.entries.map((entry, index) => <li key={`${entry.at}-${index}`} data-kind={entry.kind}>
        <time dateTime={entry.at}>{ENTRY[entry.kind] ? `${ENTRY[entry.kind]} · ` : ""}{new Date(entry.at).toLocaleString("es-DO", { dateStyle: "medium", timeStyle: "short" })}</time>
        <strong>{entry.title}</strong>
        {entry.detail && <span>{entry.detail}</span>}
      </li>)}
    </ol>}
  </div>;
}
