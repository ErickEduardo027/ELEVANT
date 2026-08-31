import { useEffect, useMemo, useState } from 'react';
import ExpandableReportRow from './ExpandableReportRow';
import ReportEmptyState from './ReportEmptyState';
import { SearchIcon } from '../../planning/components/icons';
import { compareValues } from '../reportsMappers';

const PAGE_SIZE = 10;

export default function ReportTable({
  columns,
  rows,
  getRowId = row => row.id,
  getSearchableText,
  searchPlaceholder = 'Buscar…',
  renderExpanded,
  isCriticalRow,
  emptyMessage,
}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: null, direction: 'asc' });
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [rows]);

  const searchedRows = useMemo(() => {
    if (!search.trim()) return rows;
    const query = search.trim().toLowerCase();
    return rows.filter(row => getSearchableText(row).toLowerCase().includes(query));
  }, [rows, search, getSearchableText]);

  const sortedRows = useMemo(() => {
    if (!sort.key) return searchedRows;
    const column = columns.find(item => item.key === sort.key);
    if (!column?.sortValue) return searchedRows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...searchedRows].sort((a, b) => factor * compareValues(column.sortValue(a), column.sortValue(b)));
  }, [searchedRows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function toggleSort(column) {
    if (!column.sortValue) return;
    setSort(current =>
      current.key === column.key
        ? { key: column.key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, direction: 'asc' }
    );
  }

  function toggleExpand(row) {
    const id = getRowId(row);
    setExpandedId(current => (current === id ? null : id));
  }

  return (
    <div className="space-y-3">
      <label className="flex max-w-sm flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
        <span className="sr-only">Buscar en la tabla</span>
        <span className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
          />
        </span>
      </label>

      {rows.length === 0 ? (
        <ReportEmptyState message={emptyMessage} />
      ) : sortedRows.length === 0 ? (
        <ReportEmptyState message="Ninguna fila coincide con la búsqueda." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white/70 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-b border-black/5 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:border-white/5 dark:text-text-secondary-dark">
                  {renderExpanded && <th className="w-8 px-3 py-2.5" />}
                  {columns.map(column => (
                    <th key={column.key} className="px-3 py-2.5">
                      {column.sortValue ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column)}
                          className="inline-flex items-center gap-1 hover:text-ink-900 dark:hover:text-text-primary-dark"
                        >
                          {column.label}
                          {sort.key === column.key && <span aria-hidden="true">{sort.direction === 'asc' ? '↑' : '↓'}</span>}
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(row => (
                  <ExpandableReportRow
                    key={getRowId(row)}
                    columns={columns}
                    row={row}
                    expanded={expandedId === getRowId(row)}
                    onToggleExpand={toggleExpand}
                    renderExpanded={renderExpanded}
                    critical={isCriticalRow?.(row) ?? false}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between text-xs text-text-secondary-light dark:text-text-secondary-dark">
              <span>
                {sortedRows.length} resultado{sortedRows.length === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(current => Math.max(1, current - 1))}
                  disabled={currentPage === 1}
                  className="rounded-lg border border-black/10 px-2.5 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
                >
                  Anterior
                </button>
                <span>
                  Página {currentPage} de {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(current => Math.min(pageCount, current + 1))}
                  disabled={currentPage === pageCount}
                  className="rounded-lg border border-black/10 px-2.5 py-1 font-semibold disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
