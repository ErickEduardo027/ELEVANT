"use client";

import { useEffect, useRef, useState } from "react";
import { ElevantApiError, type ContractDocumentResponse } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { ContractPdfActions } from "./ContractPdfActions";
import styles from "./AirlinePortalPage.module.css";

const PARTY: Record<string, string> = { Aviam: "AVIAM", Airline: "Su aerolínea" };

function problem(error: unknown) {
  const status = error instanceof ElevantApiError ? error.status : null;
  if (status === 403) return "Su cuenta no puede firmar este contrato.";
  if (status === 404) return "Esta versión ya no tiene documento disponible.";
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
    if (name.trim().length < 3 || title.trim().length < 2 || !accepted) {
      setMessage("Escriba su nombre completo y cargo, y confirme que acepta el contrato.");
      return;
    }
    setBusy("sign"); setMessage("");
    // A lost response is retried with the same key, so the contract is never signed twice.
    requestId.current ??= crypto.randomUUID();
    try {
      setDocument(await signContract(versionId, name, title, document.contentSha256, requestId.current));
      requestId.current = null;
      setMessage("Contrato firmado. AVIAM recibirá el aviso.");
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
      <ul className={styles.draftComments} aria-label="Firmas">
        {["Aviam", "Airline"].map(party => {
          const signature = document.signatures.find(item => item.party === party);
          return <li key={party}><strong>{PARTY[party]}</strong>
            <p>{signature ? `${signature.signerName} · ${signature.signerTitle} · ${new Date(signature.signedAt).toLocaleString("es-DO")}` : "Pendiente de firma"}</p></li>;
        })}
      </ul>
      {document.signedOn && <p className={styles.note}>Firmado por ambas partes el {document.signedOn}.</p>}
      {document.signableBy === "Airline" && <form onSubmit={sign} noValidate className={styles.draftCommentForm}>
        <label htmlFor={`signer-${versionId}`}>Nombre completo de quien firma</label>
        <input id={`signer-${versionId}`} value={name} maxLength={160} onChange={event => setName(event.target.value)} />
        <label htmlFor={`title-${versionId}`}>Cargo</label>
        <input id={`title-${versionId}`} value={title} maxLength={120} onChange={event => setTitle(event.target.value)} />
        <label><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />{" "}
          Acepto este contrato en nombre de mi aerolínea tal como figura en el PDF (huella {document.contentSha256.slice(0, 12)}…).</label>
        <button type="submit" disabled={busy === "sign"}>{busy === "sign" ? "Firmando…" : "Acepto y firmo"}</button>
      </form>}
    </>}
    {message && <p role="status">{message}</p>}
  </div>;
}
