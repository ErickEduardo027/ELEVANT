import { useEffect, useRef, useState } from 'react';
import { loadContractPdf } from '../../../services/commercialGovernanceApi';

function problem(failure) {
  if (failure?.status === 403) return 'No tienes permiso para descargar este documento.';
  if (failure?.status === 404) return 'El documento ya no está disponible. Actualiza la vista.';
  return 'No se pudo generar el PDF. Inténtalo de nuevo.';
}

/**
 * «Descargar PDF» and «Imprimir» for the API-generated contract document. Drafts use the
 * watermarked review copy. Printing loads the PDF in a hidden frame, so the paper copy matches
 * the official layout instead of the screen.
 */
export default function ContractPdfButtons({ versionId, fileName, draft = false, className = '' }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const frame = useRef(null);

  useEffect(() => () => { frame.current?.remove(); }, []);

  async function run(kind) {
    setBusy(kind);
    setError('');
    try {
      const url = URL.createObjectURL(await loadContractPdf(versionId, { draft }));
      if (kind === 'download') {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      frame.current?.remove();
      const iframe = document.createElement('iframe');
      iframe.title = `Impresión de ${fileName}`;
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      iframe.onload = () => {
        try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); }
        catch { window.open(url, '_blank', 'noopener'); }
      };
      iframe.src = url;
      document.body.appendChild(iframe);
      frame.current = iframe;
    } catch (failure) {
      setError(problem(failure));
    } finally {
      setBusy('');
    }
  }

  return (
    <div role="group" aria-label={draft ? 'PDF del borrador' : 'PDF del contrato'} className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button type="button" onClick={() => void run('download')} disabled={Boolean(busy)}
        className="min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy === 'download' ? 'Generando PDF…' : draft ? 'Descargar borrador (PDF)' : 'Descargar PDF'}</button>
      <button type="button" onClick={() => void run('print')} disabled={Boolean(busy)}
        className="min-h-[40px] rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600 disabled:opacity-50">
        {busy === 'print' ? 'Preparando impresión…' : 'Imprimir'}</button>
      {error && <p role="alert" className="basis-full text-xs text-status-danger">{error}</p>}
    </div>
  );
}
