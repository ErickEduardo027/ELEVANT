import { useState } from 'react';
import { exportContractsList } from '../../../services/contractsReportsService';
import { downloadFile } from '../../../utils/downloadFile';

const OUTLINE = 'min-h-[40px] rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600 '
  + 'disabled:opacity-50';
const SOLID = 'min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

function problem(failure, format) {
  if (failure?.status === 401) return 'La sesión expiró. Vuelve a iniciar sesión.';
  if (failure?.status === 403) return 'No tienes permiso para descargar este reporte.';
  return `No se pudo preparar el ${format === 'pdf' ? 'PDF' : 'Excel'}. Inténtalo de nuevo.`;
}

/**
 * The two downloads of the list of contracts, side by side as in every report screen: the server's «Contratos y
 * vigencias» at today's cut-off with the filters of the list, as PDF or Excel.
 */
export default function ContractListDownloads({ filters = {} }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function run(format) {
    setBusy(format);
    setError('');
    try {
      const { blob, fileName } = await exportContractsList(format, filters);
      downloadFile(blob, fileName);
    } catch (failure) {
      setError(problem(failure, format));
    } finally {
      setBusy('');
    }
  }

  return <div className="flex flex-col items-end gap-1">
    <div role="group" aria-label="Descargas del listado de contratos" className="flex flex-wrap gap-2">
      <button type="button" className={OUTLINE} disabled={Boolean(busy)} aria-busy={busy === 'pdf' || undefined}
        onClick={() => void run('pdf')}>{busy === 'pdf' ? 'Preparando PDF…' : 'Descargar PDF'}</button>
      <button type="button" className={SOLID} disabled={Boolean(busy)} aria-busy={busy === 'xlsx' || undefined}
        onClick={() => void run('xlsx')}>{busy === 'xlsx' ? 'Preparando Excel…' : 'Descargar Excel'}</button>
    </div>
    {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
  </div>;
}
