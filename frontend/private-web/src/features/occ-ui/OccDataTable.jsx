'use client';

import { Fragment, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { ChevronRightIcon } from '../shell/components/icons';
import OccGlyph from './OccGlyph';
import { OccRemoteView } from './OccPanel';
import { occUiMessages } from './occUiMessages';
import { SIGNALS } from './statusVocabulary';

/** What the register is to assistive technology: a real table, or a list of items read one by one. */
export const OCC_TABLE_KINDS = Object.freeze(['table', 'list']);
export const OCC_TABLE_ALIGNS = Object.freeze(['start', 'end']);
/** The breakpoints below which a column can be left out (src/config/breakpoints.js). */
export const OCC_TABLE_BREAKPOINTS = Object.freeze(['sm', 'md', 'lg', 'xl', '2xl']);
/** The tones a row can ask to be looked at with; any other row is calm. */
export const OCC_ROW_TONES = Object.freeze(['attention', 'urgent']);
const SORT_DIRECTIONS = Object.freeze(['asc', 'desc']);

const NO_COLUMNS = Object.freeze([]);
const NO_ROWS = Object.freeze([]);
const defaultRowId = (row, index) => row?.id ?? String(index);

// Tailwind reads classes from this file, so each one is written out whole.
const HIDE_BELOW = Object.freeze({
  table: Object.freeze({
    sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell',
    '2xl': 'hidden 2xl:table-cell',
  }),
  list: Object.freeze({
    sm: 'hidden sm:block', md: 'hidden md:block', lg: 'hidden lg:block', xl: 'hidden xl:block', '2xl': 'hidden 2xl:block',
  }),
});

// A row that asks to be looked at keeps the soft slab of its signal and a 3 px bar in its colour, with the glyph and
// the word of the signal in its first cell: never the colour alone (design B.4 and H.2). Every row carries the bar's
// room, so the columns of a lit row stay where the others are.
const TONE = Object.freeze({
  attention: Object.freeze({ slab: 'bg-occ-warn-soft', bar: 'border-l-occ-warn' }),
  urgent: Object.freeze({ slab: 'bg-occ-danger-soft', bar: 'border-l-occ-danger' }),
});
const BAR = 'border-l-[3px]';
const NO_BAR = 'border-l-transparent';

// The table: separate borders, so the sticky header keeps its joint while the body scrolls under it (a collapsed
// border scrolls away with the rows). Rows are 32 px with a mouse and 44 px on a touch screen; 1 px joints between
// them; headers are labels in sentence case, in secondary text.
const TABLE = 'w-full border-separate border-spacing-0 text-left text-sm text-occ-text';
const CAPTION = 'px-2 pb-2 text-left text-sm font-semibold text-occ-text';
const HEADER_CELL = 'sticky top-0 z-[1] border-b border-b-occ-line bg-occ-panel px-2 py-1.5 align-bottom text-xs '
  + 'font-medium text-occ-muted';
const ROW = 'h-8 [@media(pointer:coarse)]:h-11';
const CELL = 'px-2 py-1.5 align-middle';
const JOINT = 'border-t border-t-occ-line';
const SELECTABLE = 'cursor-pointer';
const HOVER = 'hover:bg-occ-panel-raised';
const SELECTED = 'bg-occ-accent-soft';
const SORT_BUTTON = 'inline-flex items-center gap-1 rounded font-medium text-occ-muted hover:text-occ-text';
// The disclosure is a 24 px control (44 px on a touch screen) that does not make its row taller.
const DISCLOSURE = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded -my-0.5 text-occ-muted '
  + 'hover:bg-occ-panel-raised hover:text-occ-text [@media(pointer:coarse)]:-my-1.5 [@media(pointer:coarse)]:h-11 '
  + '[@media(pointer:coarse)]:w-11';
const LEAD = 'flex min-w-0 items-center gap-1.5';

// The list: the same columns on a CSS grid, one template per breakpoint (the columns left out below it take no room).
const LIST_TEMPLATE = '[grid-template-columns:var(--list-cols)] sm:[grid-template-columns:var(--list-cols-sm)] '
  + 'md:[grid-template-columns:var(--list-cols-md)] lg:[grid-template-columns:var(--list-cols-lg)] '
  + 'xl:[grid-template-columns:var(--list-cols-xl)] 2xl:[grid-template-columns:var(--list-cols-2xl)]';
const LIST_ROW = `grid min-h-8 [@media(pointer:coarse)]:min-h-11 ${LIST_TEMPLATE}`;
const LIST_CELL = 'min-w-0 px-2 py-1.5';

// A key or a press that starts in one of these belongs to it, not to the row around it (the inline edit rows of
// Datos maestros, the actions of a row).
const KEY_CONTROLS = 'input, select, textarea, button, a';
const CLICK_CONTROLS = `${KEY_CONTROLS}, label, summary, [role="button"], [contenteditable]`;

const labelOf = column => column.label ?? (typeof column.header === 'string' ? column.header : '');
const domId = value => String(value).replace(/\s+/g, '_');
const isMissing = value => value === null || value === undefined || value === '' || Number.isNaN(value);

function checkColumns(columns, as) {
  for (const column of columns) {
    if (column.align !== undefined && !OCC_TABLE_ALIGNS.includes(column.align)) {
      throw new RangeError(`Unknown OCC table alignment: ${String(column.align)}`);
    }
    if (column.hideBelow !== undefined && !OCC_TABLE_BREAKPOINTS.includes(column.hideBelow)) {
      throw new RangeError(`Unknown OCC table breakpoint: ${String(column.hideBelow)}`);
    }
    if (as === 'list' && column.sortable) throw new TypeError('An OCC table drawn as a list cannot sort its columns');
  }
}

function toneOf(rowTone, row) {
  const tone = rowTone?.(row) || null;
  if (tone !== null && !OCC_ROW_TONES.includes(tone)) throw new RangeError(`Unknown OCC row tone: ${String(tone)}`);
  return tone;
}

// Missing values go last in both directions; numbers and instants compare as numbers, the rest as text in natural
// order (A1, A2, A10), without regard to case or accents.
function compareRows(left, right, direction, collator) {
  const [a, b] = [left.sortValue, right.sortValue];
  if (isMissing(a) || isMissing(b)) return Number(isMissing(a)) - Number(isMissing(b));
  const order = typeof a === 'number' && typeof b === 'number' ? a - b
    : a instanceof Date && b instanceof Date ? a.getTime() - b.getTime()
      : collator.compare(String(a), String(b));
  return direction === 'desc' ? -order : order;
}

/** The grid template of the visible columns at each breakpoint, as the custom properties LIST_TEMPLATE reads. */
function listTemplates(columns, stacked) {
  const track = column => column.width ?? 'minmax(0,1fr)';
  const visibleFrom = level => columns.filter(column => column.hideBelow === undefined
    || OCC_TABLE_BREAKPOINTS.indexOf(column.hideBelow) <= level).map(track).join(' ') || 'minmax(0,1fr)';
  const templates = { '--list-cols': stacked ? 'minmax(0,1fr)' : visibleFrom(-1) };
  OCC_TABLE_BREAKPOINTS.forEach((name, level) => { templates[`--list-cols-${name}`] = visibleFrom(level); });
  return templates;
}

// The order glyph of a sortable header: both chevrons while the column is not the order, then the one it follows.
function SortGlyph({ direction }) {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true" data-sort={direction ?? 'none'}
      className={`h-3.5 w-3.5 shrink-0 ${direction ? 'text-occ-text' : 'text-occ-faint'}`}>
      {direction !== 'desc' ? <path d="M4.5 6.5 8 3l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" /> : null}
      {direction !== 'asc' ? <path d="M4.5 9.5 8 13l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  );
}

/**
 * The dense register of the OCC (design F): the rows of a screen in a real table, or in a list where the tests and the
 * cycle E2E read them as items.
 * - `columns`: `{ key, header, label, align, width, mono, sortable, sortValue, render, hideBelow }`. `header` is the
 *   label in sentence case (a node needs `label`, the text of its stacked label); `render(row, index)` draws the cell
 *   (`row[key]` by default); `mono` sets identifiers and times in IBM Plex Mono; `align: 'end'` sets numbers on the
 *   right with tabular figures; `width` is a CSS length (a grid track in a list); `hideBelow` (`sm` … `2xl`) leaves
 *   the column out below that breakpoint. `index` is the row's place in `rows`, whatever the order on screen.
 * - `as="table"` (default): a `table` named by its `caption` (hidden unless `captionHidden` is false), with a sticky
 *   header that sticks inside the scrolling wrapper (`scrollClassName` gives it a height). A sortable column has a
 *   button in its header and `aria-sort` while it is the order: `sort` (`{ key, direction: 'asc' | 'desc' }`) and
 *   `onSortChange(next)` control it, or it keeps its own. With `stackBelow` (default) the table is a `table-stack`:
 *   below 40 rem of room each row becomes a card whose cells are labelled by `data-label` (src/styles/tokens.css);
 *   the cards keep every column.
 * - Selection (tables only): with `onSelectRow(id, row)` each row is a stop for Tab in turn (the chosen one, or the
 *   first), `aria-selected` says which is chosen (`selectedId`), a click, Enter or Space chooses one, and ArrowUp,
 *   ArrowDown, Home and End move between rows. A key or a click that starts in a control inside the row is left to
 *   that control.
 * - `as="list"`: a `ul` named by `caption` with one `li` per row on a grid of the same columns, under a header line
 *   hidden from assistive technology; each cell starts with its label for screen readers («Agente:»), and below
 *   640 px with `stackBelow` the cells stack with their labels on view. It takes no selection and no sorting.
 * - `rowTone(row)` (`attention`, `urgent` or nothing) lights a row: the soft slab, the 3 px bar and the glyph with the
 *   word of the signal.
 * - `renderExpanded(row, index)` adds a disclosure to the first cell (`aria-expanded`, `aria-controls`) and the detail
 *   under the row, always mounted and `hidden` while folded. `expandedIds` and `onToggleExpanded(id, row)` control it,
 *   or it keeps its own; `expandLabel` (a text, or `(row, expanded) => text`) names the disclosure.
 * - `status`, `staleSince`, `onRetry`, `labels`, `emptyState`, `locale` and `timeZone` go to OccRemoteView; a `success`
 *   with no rows is `empty`. `footer` goes under the rows.
 * `getRowId(row, index)` gives each row its id (`row.id`, or its index). `rowTestId` puts that `data-testid` on every
 * row (`tr` or `li`), for the screens whose tests and cycle E2E find their rows by it. The root takes `className` and
 * forwards `data-testid`. An unknown kind, alignment, breakpoint, sort direction or row tone throws.
 */
export default function OccDataTable({
  columns = NO_COLUMNS, rows = NO_ROWS, getRowId = defaultRowId, caption, captionHidden = true, as = 'table',
  selectedId, onSelectRow, sort, onSortChange, rowTone, renderExpanded, expandedIds, onToggleExpanded, expandLabel,
  status = 'success', staleSince, onRetry, labels, emptyState, locale, timeZone, footer, stackBelow = true,
  scrollClassName = '', className = '', rowTestId, 'data-testid': testId,
}) {
  if (!OCC_TABLE_KINDS.includes(as)) throw new RangeError(`Unknown OCC table kind: ${String(as)}`);
  checkColumns(columns, as);
  if (as === 'list' && (onSelectRow || sort !== undefined || onSortChange)) {
    throw new TypeError('An OCC table drawn as a list takes no selection and no sorting');
  }
  const { t, language, locale: languageLocale } = useTranslation(occUiMessages);
  const baseId = useId();
  const rowElements = useRef(new Map());
  const [ownSort, setOwnSort] = useState(null);
  const [ownExpanded, setOwnExpanded] = useState(() => new Set());
  const [focusId, setFocusId] = useState(null);

  const activeSort = sort !== undefined ? sort : ownSort;
  if (activeSort && !SORT_DIRECTIONS.includes(activeSort.direction)) {
    throw new RangeError(`Unknown OCC table sort direction: ${String(activeSort.direction)}`);
  }
  const sortColumn = activeSort ? columns.find(column => column.sortable && column.key === activeSort.key) : undefined;
  const sortDirection = sortColumn ? activeSort.direction : null;
  const collatorLocale = locale ?? languageLocale;

  // The rows in screen order, each with its id, its place in `rows` and its tone.
  const view = useMemo(() => {
    const entries = rows.map((row, index) => ({
      row, index, id: String(getRowId(row, index)), tone: toneOf(rowTone, row),
      sortValue: sortColumn ? (sortColumn.sortValue ? sortColumn.sortValue(row) : row?.[sortColumn.key]) : undefined,
    }));
    if (!sortColumn) return entries;
    const collator = new Intl.Collator(collatorLocale, { numeric: true, sensitivity: 'base' });
    return entries.toSorted((left, right) => compareRows(left, right, sortDirection, collator));
  }, [rows, getRowId, rowTone, sortColumn, sortDirection, collatorLocale]);

  const expanded = useMemo(
    () => (expandedIds !== undefined ? new Set([...expandedIds].map(String)) : ownExpanded),
    [expandedIds, ownExpanded],
  );

  const selectable = as === 'table' && typeof onSelectRow === 'function';
  const chosenId = selectedId === undefined || selectedId === null ? null : String(selectedId);
  const ids = view.map(entry => entry.id);
  let tabStop = ids[0];
  if (ids.includes(focusId)) tabStop = focusId;
  else if (ids.includes(chosenId)) tabStop = chosenId;

  function toggleSort(column) {
    const next = activeSort?.key === column.key
      ? { key: column.key, direction: activeSort.direction === 'asc' ? 'desc' : 'asc' }
      : { key: column.key, direction: 'asc' };
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
  }

  function toggleExpanded(entry) {
    if (expandedIds === undefined) {
      setOwnExpanded(current => {
        const next = new Set(current);
        if (next.has(entry.id)) next.delete(entry.id);
        else next.add(entry.id);
        return next;
      });
    }
    onToggleExpanded?.(entry.id, entry.row);
  }

  function focusRow(position) {
    const target = ids[Math.max(0, Math.min(ids.length - 1, position))];
    if (target === undefined) return;
    rowElements.current.get(target)?.focus();
    setFocusId(target);
  }

  function onRowKeyDown(event, entry, position) {
    if (event.target !== event.currentTarget && event.target.closest(KEY_CONTROLS)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' || event.key === ' ') onSelectRow(entry.id, entry.row);
    else if (event.key === 'ArrowDown') focusRow(position + 1);
    else if (event.key === 'ArrowUp') focusRow(position - 1);
    else if (event.key === 'Home') focusRow(0);
    else if (event.key === 'End') focusRow(ids.length - 1);
    else return;
    event.preventDefault();
  }

  function onRowClick(event, entry) {
    if (event.target !== event.currentTarget && event.target.closest(CLICK_CONTROLS)) return;
    onSelectRow(entry.id, entry.row);
  }

  const detailId = entry => `${baseId}-detail-${domId(entry.id)}`;
  const glyphOf = entry => (entry.tone ? <OccGlyph name={entry.tone} title={SIGNALS[entry.tone][language]} /> : null);

  function disclosureOf(entry) {
    if (typeof renderExpanded !== 'function') return null;
    const open = expanded.has(entry.id);
    let name = t(open ? 'table.collapse' : 'table.expand');
    if (typeof expandLabel === 'function') name = expandLabel(entry.row, open);
    else if (typeof expandLabel === 'string') name = expandLabel;
    return (
      <button type="button" aria-expanded={open} aria-controls={detailId(entry)} onClick={() => toggleExpanded(entry)}
        className={DISCLOSURE}>
        <ChevronRightIcon className={`h-4 w-4 ${open ? 'rotate-90' : ''}`} />
        <span className="sr-only">{name}</span>
      </button>
    );
  }

  // The content of a cell; the first one also holds the disclosure and the signal of a lit row.
  function contentOf(column, entry, first) {
    const content = typeof column.render === 'function' ? column.render(entry.row, entry.index) : entry.row?.[column.key];
    const disclosure = first ? disclosureOf(entry) : null;
    const glyph = first ? glyphOf(entry) : null;
    if (!disclosure && !glyph) return content;
    return <span className={LEAD}>{disclosure}{glyph}<span className="min-w-0">{content}</span></span>;
  }

  // Where a column shows, how it aligns and, for its cells, whether it is an identifier. A header is a label: never mono.
  const placeClass = (column, kind) => [
    column.hideBelow ? HIDE_BELOW[kind][column.hideBelow] : '',
    column.align === 'end' ? (kind === 'list' && stackBelow ? 'sm:text-right' : 'text-right') : '',
  ].filter(Boolean).join(' ');
  const cellClass = (column, kind) => [
    placeClass(column, kind), column.align === 'end' ? 'tabular-nums' : '', column.mono ? 'font-mono' : '',
  ].filter(Boolean).join(' ');

  function headerCell(column) {
    const direction = sortColumn?.key === column.key ? sortDirection : null;
    const ariaSort = direction ? { 'aria-sort': direction === 'asc' ? 'ascending' : 'descending' } : {};
    const hintId = `${baseId}-sort-${domId(column.key)}`;
    return (
      <th key={column.key} scope="col" {...ariaSort} style={column.width ? { width: column.width } : undefined}
        className={`${HEADER_CELL} ${placeClass(column, 'table')}`}>
        {column.sortable ? (
          <>
            <button type="button" onClick={() => toggleSort(column)} aria-describedby={hintId} className={SORT_BUTTON}>
              {column.header}
              <SortGlyph direction={direction} />
              {direction ? (
                <span className="sr-only">{`, ${t(direction === 'asc' ? 'table.sortAscending' : 'table.sortDescending')}`}</span>
              ) : null}
            </button>
            <span id={hintId} hidden>{t('table.sortBy', { column: labelOf(column) })}</span>
          </>
        ) : column.header}
      </th>
    );
  }

  function tableRow(entry, position) {
    const chosen = selectable && entry.id === chosenId;
    const tone = entry.tone ? TONE[entry.tone] : null;
    const slab = chosen ? SELECTED : tone?.slab ?? (selectable ? HOVER : '');
    const bar = `${BAR} ${tone?.bar ?? NO_BAR}`;
    const joint = position > 0 ? JOINT : '';
    const select = selectable ? {
      tabIndex: entry.id === tabStop ? 0 : -1,
      'aria-selected': chosen,
      onClick: event => onRowClick(event, entry),
      onKeyDown: event => onRowKeyDown(event, entry, position),
      onFocus: () => setFocusId(entry.id),
      ref: element => {
        if (element) rowElements.current.set(entry.id, element);
        else rowElements.current.delete(entry.id);
      },
    } : {};
    return (
      <Fragment key={entry.id}>
        <tr data-occ-row="" data-testid={rowTestId} data-occ-tone={entry.tone ?? undefined} {...select}
          className={`${ROW} ${slab} ${selectable ? SELECTABLE : ''}`}>
          {columns.map((column, index) => (
            <td key={column.key} data-label={stackBelow ? labelOf(column) : undefined}
              className={`${CELL} ${joint} ${index === 0 ? bar : ''} ${cellClass(column, 'table')}`}>
              {contentOf(column, entry, index === 0)}
            </td>
          ))}
        </tr>
        {typeof renderExpanded === 'function' ? (
          <tr id={detailId(entry)} hidden={!expanded.has(entry.id)} data-occ-row-detail=""
            data-occ-tone={entry.tone ?? undefined} className={chosen ? SELECTED : tone?.slab ?? ''}>
            <td colSpan={Math.max(columns.length, 1)} className={`px-2 pb-3 pt-1 ${bar}`}>
              {renderExpanded(entry.row, entry.index)}
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  function listItem(entry, position) {
    const tone = entry.tone ? TONE[entry.tone] : null;
    return (
      <li key={entry.id} data-occ-row="" data-testid={rowTestId} data-occ-tone={entry.tone ?? undefined}
        className={`${BAR} ${tone?.bar ?? NO_BAR} ${tone?.slab ?? ''} ${position > 0 ? JOINT : ''}`}>
        <div className={LIST_ROW}>
          {columns.map((column, index) => {
            const label = labelOf(column);
            return (
              <div key={column.key} className={`${LIST_CELL} ${cellClass(column, 'list')}`}>
                {label ? (
                  <span className={stackBelow ? 'block text-xs font-medium text-occ-muted sm:sr-only' : 'sr-only'}>
                    {label}<span className="sr-only">: </span>
                  </span>
                ) : null}
                {contentOf(column, entry, index === 0)}
              </div>
            );
          })}
        </div>
        {typeof renderExpanded === 'function' ? (
          <div id={detailId(entry)} hidden={!expanded.has(entry.id)} data-occ-row-detail="" className="px-2 pb-3 pt-1">
            {renderExpanded(entry.row, entry.index)}
          </div>
        ) : null}
      </li>
    );
  }

  const captionId = `${baseId}-caption`;
  let body;
  if (as === 'table') {
    body = (
      <div className={`min-w-0 overflow-auto ${scrollClassName}`}>
        <table className={`${TABLE} ${stackBelow ? 'table-stack' : ''}`}>
          {caption ? <caption className={captionHidden ? 'sr-only' : CAPTION}>{caption}</caption> : null}
          <thead><tr>{columns.map(headerCell)}</tr></thead>
          <tbody>{view.map(tableRow)}</tbody>
        </table>
      </div>
    );
  } else {
    const header = `${BAR} ${NO_BAR} border-b border-b-occ-line text-xs font-medium text-occ-muted `
      + `${stackBelow ? 'hidden sm:grid' : 'grid'} ${LIST_TEMPLATE}`;
    body = (
      <div style={listTemplates(columns, stackBelow)} className={`min-w-0 overflow-auto text-sm text-occ-text ${scrollClassName}`}>
        {caption && !captionHidden ? <p id={captionId} className={CAPTION}>{caption}</p> : null}
        <div aria-hidden="true" data-occ-list-header="" className={header}>
          {columns.map(column => (
            <div key={column.key} className={`${LIST_CELL} ${placeClass(column, 'list')}`}>{column.header}</div>
          ))}
        </div>
        <ul aria-label={captionHidden ? caption : undefined} aria-labelledby={caption && !captionHidden ? captionId : undefined}>
          {view.map(listItem)}
        </ul>
      </div>
    );
  }

  return (
    <div data-occ-table={as} data-testid={testId} className={`min-w-0 ${className}`}>
      <OccRemoteView status={status === 'success' && view.length === 0 ? 'empty' : status} staleSince={staleSince}
        onRetry={onRetry} labels={labels} emptyState={emptyState} locale={locale} timeZone={timeZone}>
        {body}
        {footer ? <div data-occ-table-footer="" className={`${JOINT} px-2 py-2`}>{footer}</div> : null}
      </OccRemoteView>
    </div>
  );
}
