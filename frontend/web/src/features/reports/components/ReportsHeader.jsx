import ExportButton from './ExportButton';

export default function ReportsHeader({ periodLabel, activeReport, onExported, onExportError }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Dashboard / Reportes</p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Reportes</h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary-light dark:text-text-secondary-dark">
            Consulta y analiza el desempeño operacional.
          </p>
          {periodLabel && (
            <p className="mt-1 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {periodLabel}
            </p>
          )}
        </div>
        <ExportButton reportId={activeReport} onExported={onExported} onExportError={onExportError} />
      </div>
    </div>
  );
}
