import { useEffect, useRef, useState } from 'react';
import { exportReport } from '../../../services/reportsService';
import { DownloadIcon } from '../../planning/components/icons';
import { ChevronDownIcon } from '../../dashboard/components/icons';

const STATE_LABEL = {
  idle: 'Exportar',
  generating: 'Generando…',
  completed: 'Completado',
  error: 'Reintentar',
};

const STATE_CLASS = {
  idle: 'border-accent-600/30 text-accent-600 hover:bg-accent-600/10',
  generating: 'border-accent-600/30 text-accent-600',
  completed: 'border-status-success/40 text-status-success',
  error: 'border-status-danger/40 text-status-danger hover:bg-status-danger/10',
};

export default function ExportButton({ reportId, exportFn = exportReport, onExported, onExportError, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState('idle');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleExport(format) {
    setOpen(false);
    setState('generating');
    try {
      const result = await exportFn({ reportId, format });
      if (!mountedRef.current) return;
      setState('completed');
      onExported?.(result);
      setTimeout(() => {
        if (mountedRef.current) setState('idle');
      }, 2000);
    } catch (error) {
      if (!mountedRef.current) return;
      setState('error');
      onExportError?.(error);
      setTimeout(() => {
        if (mountedRef.current) setState('idle');
      }, 2500);
    }
  }

  const busy = state === 'generating';

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        disabled={disabled || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${STATE_CLASS[state]} ${
          disabled || busy ? 'cursor-not-allowed' : ''
        }`}
      >
        {busy ? (
          <span
            data-testid="export-spinner"
            aria-hidden="true"
            className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        ) : (
          <DownloadIcon className="h-3.5 w-3.5" />
        )}
        {STATE_LABEL[state]}
        {!busy && <ChevronDownIcon className="h-3 w-3" />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport('pdf')}
            className="block w-full px-3 py-1.5 text-left text-xs text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            PDF
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => handleExport('excel')}
            className="block w-full px-3 py-1.5 text-left text-xs text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Excel
          </button>
        </div>
      )}
    </div>
  );
}
