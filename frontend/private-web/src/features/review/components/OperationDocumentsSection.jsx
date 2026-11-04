import { useEffect, useState } from 'react';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import {
  DOCUMENT_TITLES,
  SIGNER_ROLES,
  downloadOccOperationDocument,
  getOccOperationDocuments,
} from '../../../services/occDocumentsService';

/**
 * «Formularios AVIAM» in the OCC review (ADR-0032): the forms generated from what the agent
 * captured, who already signed each one, and the PDF exactly as the airline receives it.
 */
export default function OperationDocumentsSection({ operationId }) {
  const [state, setState] = useState({ status: 'loading' });
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getOccOperationDocuments(operationId, { signal: controller.signal })
      .then(data => setState({ status: data.documents.length ? 'success' : 'empty', data }))
      .catch(error => { if (!isAbortError(error)) setState({ status: 'error', error }); });
    return () => abortForEffectCleanup(controller);
  }, [operationId, attempt]);

  async function download(document) {
    setDownloading(document.kind);
    setDownloadError(null);
    try {
      await downloadOccOperationDocument(operationId, document);
    } catch (error) {
      setDownloadError(error.message);
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section aria-label="Formularios AVIAM" className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Formularios AVIAM</h3>
        {state.status === 'success' && (
          <p className="text-xs text-ink-600 dark:text-text-secondary-dark">
            {state.data.damageMarks.length} daño(s) marcados en el walk-around
          </p>
        )}
      </div>
      {state.status === 'loading' && <p className="text-sm" role="status">Cargando formularios…</p>}
      {state.status === 'empty' && <p className="text-sm">Esta operación aún no tiene formularios.</p>}
      {state.status === 'error' && (
        <div role="alert" className="space-y-2 text-sm">
          <p>{state.error.message}</p>
          {state.error.status !== 403 && (
            <button type="button" onClick={() => { setState({ status: 'loading' }); setAttempt(value => value + 1); }}
              className="min-h-11 rounded-lg border border-accent-600 px-3 py-2 font-semibold">Reintentar</button>
          )}
        </div>
      )}
      {state.status === 'success' && (
        <ul className="grid gap-3 lg:grid-cols-3">
          {state.data.documents.map(document => (
            <li key={document.kind} className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 dark:border-white/10">
              <div>
                <p className="font-semibold">{DOCUMENT_TITLES[document.kind] ?? document.title}</p>
                <p className="text-xs text-ink-600 dark:text-text-secondary-dark">{document.number} · {document.formCode}</p>
              </div>
              <ul className="space-y-1 text-sm">
                {document.requiredRoles.map(role => {
                  const signature = document.signatures.find(item => item.role === role);
                  const stale = document.staleRoles.includes(role);
                  return (
                    <li key={role} className="flex justify-between gap-2">
                      <span>{SIGNER_ROLES[role] ?? role}</span>
                      <span className={signature ? 'font-semibold text-status-success' : stale ? 'text-status-warning' : 'text-ink-600 dark:text-text-secondary-dark'}>
                        {signature ? `✓ ${signature.signerName}` : stale ? 'Firmar de nuevo' : 'Pendiente'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="break-all font-mono text-[11px] text-ink-600 dark:text-text-secondary-dark" title="Huella SHA-256 del contenido">
                {document.contentSha256.slice(0, 16)}…
              </p>
              <button type="button" disabled={downloading !== null} onClick={() => void download(document)}
                className="mt-auto min-h-11 rounded-lg bg-accent-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {downloading === document.kind ? 'Generando PDF…' : 'Descargar PDF'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {downloadError && <p role="alert" className="text-sm text-status-danger">{downloadError}</p>}
    </section>
  );
}
