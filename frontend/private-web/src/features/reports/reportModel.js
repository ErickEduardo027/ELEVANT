import { addDays, formatBusinessDateTime } from '../../services/businessDay';

/**
 * The pure rules of the report screens (ADR-0048, PR D): the period shortcuts in the station's calendar, the figures
 * written as the PDF and Excel exports write them (es-DO: «1,234.50», «7.5 %», «dd/mm/aaaa», 24 h), the totals the
 * screen may add on its own, and the lines that say what a result is («Filtros aplicados: …», «Generado el … por …»,
 * «N filas en el período»). No colour lives here: both skins (occ-ui and the department pages) use them.
 */

/** The period shortcuts, in the order the filter bar offers them. */
export const PERIOD_PRESETS = Object.freeze([
  { id: 'today', label: 'Hoy' },
  { id: 'last7', label: 'Últimos 7 días' },
  { id: 'thisMonth', label: 'Este mes' },
  { id: 'lastMonth', label: 'Mes anterior' },
  { id: 'custom', label: 'Personalizado' },
]);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY_DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const CLOCK = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const NUMERIC_TYPES = new Set(['number', 'money', 'percent', 'duration']);
const SUMMABLE_TYPES = new Set(['number', 'money']);

/**
 * The dates of a shortcut, with `today` the station's day (`businessToday`); `custom` has none.
 *
 * @param {string} preset
 * @param {string} today ISO date
 * @returns {{ from: string, to: string } | null}
 */
export function presetRange(preset, today) {
  if (!ISO_DATE.test(today ?? '')) return null;
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'thisMonth': return { from: monthStart, to: today };
    case 'lastMonth': {
      const to = addDays(monthStart, -1);
      return { from: `${to.slice(0, 8)}01`, to };
    }
    default: return null;
  }
}

/** The shortcut a period matches, or `custom`. */
export function matchPreset(from, to, today) {
  const found = PERIOD_PRESETS.find(preset => {
    const range = presetRange(preset.id, today);
    return range && range.from === from && range.to === to;
  });
  return found?.id ?? 'custom';
}

/** Days of a period counting both ends; 0 when it is not a valid period. */
export function rangeDays(from, to) {
  if (!ISO_DATE.test(from ?? '') || !ISO_DATE.test(to ?? '') || from > to) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** «2026-11-03» → «03/11/2026». */
export function formatIsoDate(value) {
  const match = ISO_DATE.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? '');
}

/** «01/11/2026 – 21/11/2026», or the single date of a cut-off report. */
export function periodLabel(from, to, { asOfDate = false } = {}) {
  return asOfDate || from === to ? formatIsoDate(to) : `${formatIsoDate(from)} – ${formatIsoDate(to)}`;
}

/** A number column is a figure: it sits on the right with tabular figures. */
export const isNumericType = type => NUMERIC_TYPES.has(type);

const grouped = (value, decimals) => new Intl.NumberFormat('en-US', {
  minimumFractionDigits: decimals, maximumFractionDigits: decimals,
}).format(value);

function decimalsOf(text) {
  const dot = text.indexOf('.');
  return dot < 0 ? 0 : Math.min(2, text.length - dot - 1);
}

/**
 * A cell as the exports print it. The server sends invariant figures («1234.5») and ISO dates; what it already
 * formatted («03/11/2026», «Arajet») stays as it is, and a value that does not read as its type is shown unchanged.
 *
 * @param {unknown} value
 * @param {string} [type] text, number, money, percent, date, datetime, time or duration
 * @param {{ currency?: string, timeZone?: string | null }} [options]
 */
export function formatReportValue(value, type = 'text', { currency = '', timeZone = null } = {}) {
  if (value === null || value === undefined) return '—';
  const text = String(value).trim();
  if (text === '') return '—';
  if (NUMERIC_TYPES.has(type)) {
    const number = Number(text);
    if (!/^-?\d+(\.\d+)?$/.test(text) || !Number.isFinite(number)) return text;
    if (type === 'money') return `${currency ? `${currency} ` : ''}${grouped(number, 2)}`;
    if (type === 'percent') return `${grouped(Math.round(number * 10) / 10, 1)} %`;
    if (type === 'duration') {
      const minutes = Math.round(Math.abs(number));
      return `${number < 0 ? '-' : ''}${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
    }
    return grouped(number, decimalsOf(text));
  }
  if (type === 'date') return ISO_DATE.test(text) ? formatIsoDate(text) : text;
  if (type === 'time') {
    const match = CLOCK.exec(text);
    return match ? `${match[1].padStart(2, '0')}:${match[2]}` : text;
  }
  if (type === 'datetime' && INSTANT.test(text)) return formatBusinessDateTime(text, { timeZone }).replace(', ', ' ');
  if (DMY_DATE.test(text)) return text;
  return text;
}

/**
 * «Generado el 26/10/2026 08:00 por Ana Pérez», in the station's local time; `template` gives another language
 * (`{date}` and `{by}`).
 */
export function formatGeneratedAt(asOf, { by = '', locale = 'es-DO', timeZone = null, template } = {}) {
  const date = formatBusinessDateTime(asOf, { locale, timeZone }).replace(', ', ' ');
  const pattern = template ?? (by ? 'Generado el {date} por {by}' : 'Generado el {date}');
  return pattern.replace('{date}', date).replace('{by}', by).replace(/\s+(by|por)\s*$/, '');
}

/**
 * The totals row the screen may add when the server sends none: the sum of each `number` column and of each `money`
 * column whose rows share one currency. Percentages, durations and text never add up. The caller asks only when the
 * whole period is on screen, never for one page of many.
 *
 * @param {{ type?: string, currencyOf?: (row: unknown[]) => string }[]} columns
 * @param {unknown[][]} rows the raw cell values
 * @param {{ currencyOf?: (row: unknown[], index: number) => string, label?: string }} [options]
 * @returns {{ label: string, cells: string[] } | null}
 */
export function computeTotals(columns, rows, { currencyOf, label = 'Total' } = {}) {
  if (!rows.length) return null;
  const currencies = currencyOf ? new Set(rows.map((row, index) => currencyOf(row, index) ?? '')) : new Set(['']);
  let any = false;
  const cells = columns.map((column, index) => {
    const mixed = column.currencyOf ? new Set(rows.map(row => column.currencyOf(row) ?? '')).size > 1
      : currencies.size > 1;
    if (!SUMMABLE_TYPES.has(column.type) || (column.type === 'money' && mixed)) return '';
    let sum = 0;
    let scale = 0;
    for (const row of rows) {
      const text = String(row[index] ?? '').trim();
      if (text === '') continue;
      if (!/^-?\d+(\.\d+)?$/.test(text)) return '';
      sum += Number(text);
      scale = Math.max(scale, decimalsOf(text));
    }
    any = true;
    return String(Math.round(sum * 10 ** scale) / 10 ** scale);
  });
  if (!any) return null;
  if (cells[0] === '' && !SUMMABLE_TYPES.has(columns[0]?.type)) cells[0] = label;
  return { label, cells };
}

/** «Filtros aplicados: Estación PUJ · Período 01/11/2026 – 21/11/2026». */
export function filtersSummary(items, { prefix = 'Filtros aplicados' } = {}) {
  const parts = (items ?? []).filter(item => item?.label && item.value).map(item => `${item.label} ${item.value}`);
  return parts.length ? `${prefix}: ${parts.join(' · ')}` : '';
}

const SPANISH_COUNTS = Object.freeze({
  periodOne: '1 fila en el período',
  period: '{count} filas en el período',
  onPage: ' · página {page}',
  pageOne: 'Página {page} · 1 fila en esta página',
  page: 'Página {page} · {count} filas en esta página',
});

const count = value => new Intl.NumberFormat('en-US').format(value);

/**
 * How many rows the result has: of the whole period when known (`totalRows`, or every row when the report is not
 * paged), else of the page on screen. Nothing for an empty result, whose body says so.
 */
export function rowsCountText({ rows, totalRows, page, paged }, messages = SPANISH_COUNTS) {
  if (!rows) return '';
  const total = Number.isInteger(totalRows) && totalRows >= rows ? totalRows : !paged ? rows : null;
  if (total !== null) {
    const text = total === 1 ? messages.periodOne : messages.period.replace('{count}', count(total));
    return paged && total > rows ? text + messages.onPage.replace('{page}', page) : text;
  }
  return (rows === 1 ? messages.pageOne : messages.page).replace('{page}', page).replace('{count}', count(rows));
}

/**
 * The column type of a server report page: the server's when it sends it (ADR-0048), else `number` for a column of
 * numbers and `text` otherwise, as before.
 */
function columnType(page, index) {
  const declared = page.columnTypes?.[index];
  if (typeof declared === 'string' && declared) return declared;
  return page.rows.some(row => row[index]?.type === 'number') ? 'number' : 'text';
}

/**
 * A server report page with typed cells (OCC, and the areas that follow its contract, ADR-0048) in the shape of
 * useServerReport: plain cell values and every optional field in place.
 */
export function normalizeServerPage(page) {
  const total = Array.isArray(page.totals) ? page.totals[0] : undefined;
  return {
    key: page.key, title: page.title, asOf: page.asOf, generatedBy: page.generatedBy ?? '',
    station: page.stationName ? `${page.stationCode} · ${page.stationName}` : page.stationCode,
    columns: page.columns.map((label, index) => ({ label, type: columnType(page, index) })),
    rows: page.rows.map(row => row.map(cell => cell?.value ?? '')),
    // An older API sends no `totals` (the screen adds the whole period itself); the new one sends a list, maybe empty.
    ...(Array.isArray(page.totals) && { totals: total
      ? { label: total.label, cells: total.cells.map(cell => cell?.value ?? '') } : null }),
    summary: Array.isArray(page.summary) ? page.summary : [],
    totalRows: Number.isInteger(page.totalRows) ? page.totalRows : null,
    appliedFilters: Array.isArray(page.appliedFilters) ? page.appliedFilters : [],
    page: page.page, hasMore: page.hasMore,
  };
}
