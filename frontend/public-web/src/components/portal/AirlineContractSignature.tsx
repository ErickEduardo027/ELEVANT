"use client";

import { useEffect, useRef, useState } from "react";
import { ElevantApiError, type ContractDocumentResponse } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { ContractPdfActions } from "./ContractPdfActions";
import { SignaturePad } from "./SignaturePad";
import styles from "./AirlinePortalPage.module.css";

const PARTY: Record<string, string> = { Aviam: "AVIAM", Airline: "Su aerolínea" };

function date(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

/** Validity and renewal terms Contratos confirmed after Finance (ADR-0025). */
export function validitySummary(document: ContractDocumentResponse): string[] {
  const validity = document.validity;
  if (!validity) return [];
  const lines = [`Vigencia: del ${date(document.validFrom)} al ${document.validTo ? date(document.validTo) : "sin fecha de fin"}.`];
  lines.push(validity.renewalMode === "Automatic"
    ? `Renovación automática por ${validity.renewalTermMonths} meses; se inicia ${validity.renewalNoticeDays} días antes del vencimiento y vuelve a firmarse.`
    : `Renovación manual${validity.renewalTermMonths ? ` por períodos de ${validity.renewalTermMonths} meses` : ""}; aviso ${validity.renewalNoticeDays} días antes.`);
  lines.push(`Terminación con ${validity.terminationNoticeDays} días de preaviso.` +
    (validity.terminationTerms ? ` ${validity.terminationTerms}` : ""));
  return lines;
}

function problem(error: unknown) {
  const status = error instanceof ElevantApiError ? error.status : null;
  if (status === 403) return "Su cuenta no puede firmar este contrato.";
  if (status === 404) return "Esta versión ya no tiene documento disponible.";
  if (status === 409 && error instanceof ElevantApiError && error.code === "validity_pending")
    return "Contratos aún está fijando la vigencia; podrá firmar cuando la confirme.";
  if (status === 409) return "El contrato cambió o ya fue firmado; se volvió a cargar. Revíselo antes de firmar.";
  return "No fue posible completar la operación. Intente de nuevo.";
}

/** Download and signature of one approved contract version in the airline portal. */
export function AirlineContractSignature({ versionId, fileName }: { versionId: string; fileName: string }) {
  const { getContractDocument, downloadContractDocument, signContract } = useAirlineSession();
  const [document, setDocument] = useState<ContractDocumentResponse | null>(null);
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    getContractDocument(versionId).then(result => { if (active) setDocument(result); })
      .catch(error => { if (active) setMessage(problem(error)); });
    return () => { active = false; };
  }, [getContractDocument, versionId, revision]);

  async function sign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) return;
    if (name.trim().length < 3 || title.trim().length < 2 || !accepted || !drawn) {
      setMessage("Escriba su nombre completo y cargo, dibuje su firma y confirme que acepta el contrato.");
      return;
    }
    setBusy("sign"); setMessage("");
    // A lost response is retried with the same key, so the contract is never signed twice.
    requestId.current ??= crypto.randomUUID();
    try {
      setDocument(await signContract(versionId, name, title, document.contentSha256, drawn, requestId.current));
      requestId.current = null;
      setMessage("Contrato firmado. AVIAM lo contrafirmará y recibirá el PDF firmado por correo.");
    } catch (error) {
      if (error instanceof ElevantApiError) requestId.current = null;
      setMessage(problem(error));
      if (error instanceof ElevantApiError && error.status === 409) setRevision(value => value + 1);
    } finally { setBusy(""); }
  }

  return <div className={styles.contractVersion}>
    <h3>Documento y firmas</h3>
    <ContractPdfActions load={() => downloadContractDocument(versionId)} fileName={fileName} label="contrato firmable" />
    {document && <>
      {document.validity
        ? <ul className={styles.draftComments} aria-label="Vigencia y renovación">
            {validitySummary(document).map(line => <li key={line}><p>{line}</p></li>)}
          </ul>
        : document.signatures.length === 0 && document.versionStatus === "Approved" &&
          <p className={styles.note}>Contratos está fijando la vigencia y la renovación; después podrá firmar.</p>}
      <ul className={styles.draftComments} aria-label="Firmas">
        {["Aviam", "Airline"].map(party => {
          const signature = document.signatures.find(item => item.party === party);
          return <li key={party}><strong>{PARTY[party]}</strong>
            <p>{signature
              ? `${signature.signerName} · ${signature.signerTitle} · ${new Date(signature.signedAt).toLocaleString("es-DO")}` +
                (signature.hasDrawnSignature ? " · firma dibujada" : "")
              : party === "Aviam" ? "Contrafirma después de su aerolínea" : "Pendiente de firma"}</p></li>;
        })}
      </ul>
      {/* signedOn belongs to the contract; this version counts as signed only with both parties on it. */}
      {document.signedOn && document.signatures.length === 2 &&
        <p className={styles.note}>Firmado por ambas partes el {document.signedOn}.</p>}
      {document.signableBy === "Airline" && <form onSubmit={sign} noValidate className={styles.draftCommentForm}>
        <label htmlFor={`signer-${versionId}`}>Nombre completo de quien firma</label>
        <input id={`signer-${versionId}`} value={name} maxLength={160} onChange={event => setName(event.target.value)} />
        <label htmlFor={`title-${versionId}`}>Cargo</label>
        <input id={`title-${versionId}`} value={title} maxLength={120} onChange={event => setTitle(event.target.value)} />
        <SignaturePad id={`signature-${versionId}`} label="Firma" onChange={setDrawn} />
        <label><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />{" "}
          Acepto este contrato en nombre de mi aerolínea tal como figura en el PDF (huella {document.contentSha256.slice(0, 12)}…).</label>
        <button type="submit" disabled={busy === "sign"}>{busy === "sign" ? "Firmando…" : "Acepto y firmo"}</button>
      </form>}
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
