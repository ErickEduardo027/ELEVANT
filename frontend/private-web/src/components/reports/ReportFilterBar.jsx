import FilterBar from '../FilterBar';
import { PERIOD_PRESETS } from '../../features/reports/reportModel';

export const REPORT_FIELD = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-normal '
  + 'text-ink-900 outline-none focus-visible:ring-2 focus-visible:ring-accent-600 disabled:opacity-60 '
  + 'dark:border-white/10 dark:bg-surface-dark dark:text-text-primary-dark';
const LABEL = 'text-xs font-semibold text-ink-900 dark:text-text-primary-dark';

/** Why «Generar» did not ask the server (useServerReport `validation`). */
export function validationText(validation, maxRangeDays) {
  if (validation === 'missing') return 'Elige las fechas del período.';
  if (validation === 'order') return '«Desde» no puede ser posterior a «Hasta».';
  if (validation === 'range') return `El período admite hasta ${maxRangeDays} días. Acórtalo o elige otro atajo.`;
  return '';
}

/**
 * The filters of a department report (ADR-0048, PR D): the report, the period with its shortcuts (Hoy · Últimos 7
 * días · Este mes · Mes anterior · Personalizado), «Desde» only when the report is not a cut-off, the area's own
 * filters (`children`) and «Generar». The chosen report's description sits under the bar.
 */
export default function ReportFilterBar({ report, children, showReportSelect = true, label = 'Filtros del reporte' }) {
  const { catalog, draft, selected, validation } = report;
  const asOfDate = Boolean(selected?.asOfDate);
  const ready = catalog.status === 'success' && Boolean(selected);
  const message = validationText(validation, catalog.maxRangeDays);
  return (
    <form role="search" aria-label={label} noValidate onSubmit={report.generate}
      className="space-y-3 rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/5 dark:bg-surface-dark-card">
      <FilterBar actions={(
        <button type="submit" disabled={!ready}
          className="min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Generar
        </button>
      )}>
        {showReportSelect && (
          <label className={LABEL}>Reporte
            <select className={REPORT_FIELD} value={draft.key} disabled={!ready}
              onChange={event => report.setKey(event.target.value)}>
              {catalog.reports.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}
            </select>
          </label>
        )}
        {!asOfDate && (
          <label className={LABEL}>Período
            <select className={REPORT_FIELD} value={draft.preset} onChange={event => report.setPreset(event.target.value)}>
              {PERIOD_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </label>
        )}
        {!asOfDate && (
          <label className={LABEL}>Desde
            <input type="date" className={REPORT_FIELD} value={draft.from} max={draft.to}
              onChange={event => report.setDate('from', event.target.value)} />
          </label>
        )}
        <label className={LABEL}>{asOfDate ? 'Fecha de corte' : 'Hasta'}
          <input type="date" className={REPORT_FIELD} value={draft.to} min={asOfDate ? undefined : draft.from}
            onChange={event => report.setDate('to', event.target.value)} />
        </label>
        {children}
      </FilterBar>
      {selected?.description && (
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {selected.description}{asOfDate ? ' Es un reporte a una fecha de corte: solo cuenta la fecha elegida.' : ''}
        </p>
      )}
      {message && <p role="alert" className="text-sm text-status-danger">{message}</p>}
    </form>
  );
}

/** A select of the area's filters, with «Todas» or «Todos» first. */
export function ReportSelectFilter({ label, value, onChange, options, allLabel = 'Todas', disabled = false }) {
  return (
    <label className={LABEL}>{label}
      <select className={REPORT_FIELD} value={value ?? ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
