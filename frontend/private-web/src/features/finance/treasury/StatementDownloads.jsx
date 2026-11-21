import { useState } from 'react';
import { exportFinanceStatement, statementExportsAvailable, statementFileName, treasuryError } from
  '../../../services/financeTreasuryService';
import { downloadFile } from '../../../utils/downloadFile';

const OUTLINE = 'min-h-[40px] rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600 disabled:opacity-50';
const SOLID = 'min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

/**
 * «Descargar PDF» and «Descargar Excel» of the statement on screen (ADR-0048, PR D), side by side. They appear only
 * when the API can generate the statement: never a button that cannot act. The file is the whole statement at its
 * cut-off with the station and airline chosen.
 */
export default function StatementDownloads({ filters, available = statementExportsAvailable }) {
  const [enabled] = useState(() => (typeof available === 'function' ? available() : Boolean(available)));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  if (!enabled) return null;

  async function download(format) {
    setBusy(format);
    setError('');
    try {
      downloadFile(await exportFinanceStatement(filters, format), statementFileName(filters, format));
    } catch (failure) {
      setError(`No se pudo descargar el ${format === 'pdf' ? 'PDF' : 'Excel'}: ${treasuryError(failure)}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div role="group" aria-label="Descargas del estado de cuenta" className="flex flex-wrap items-center gap-2">
      <button type="button" className={OUTLINE} disabled={Boolean(busy)} onClick={() => void download('pdf')}>
        {busy === 'pdf' ? 'Preparando PDF…' : 'Descargar PDF'}
      </button>
      <button type="button" className={SOLID} disabled={Boolean(busy)} onClick={() => void download('xlsx')}>
        {busy === 'xlsx' ? 'Preparando Excel…' : 'Descargar Excel'}
      </button>
      {error && <p role="alert" className="basis-full text-sm text-status-danger">{error}</p>}
    </div>
  );
}
