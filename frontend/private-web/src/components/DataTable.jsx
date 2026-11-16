import { useMemo, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '../features/shell/components/icons';
import StackedTable from './StackedTable';

// Tabla enterprise genérica: columnas declarativas, paginación cliente y
// selección múltiple opcional. Generalizada de ReportTable +
// ReviewQueueTable (`feat/adminocc`) en un único componente reutilizable
// por cualquier módulo, no solo Gestión de usuarios. Preparada para migrar
// a paginación/búsqueda server-side sin cambiar la API pública: basta con
// que `rows` llegue ya paginado/filtrado y se agregue un prop de control de
// página externo más adelante.
export default function DataTable({
  columns,
  rows,
  getRowId,
  loading = false,
  emptyState,
  selectable = false,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowClick,
  pageSize = 10,
  minWidthClassName = 'min-w-[720px]',
}) {
  const [page, setPage] = useState(0);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [rows, currentPage, pageSize]
  );

  const allVisibleSelected =
    selectable && pageRows.length > 0 && pageRows.every(row => selectedIds?.has(getRowId(row)));

  return (
    <div className="overflow-hidden rounded-2xl border border-black/5 bg-white/70 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <StackedTable>
        <table className={`table-stack w-full text-left text-sm ${minWidthClassName}`}>
          <thead>
            <tr className="border-b border-black/5 text-xs font-medium uppercase tracking-wide text-text-secondary-light dark:border-white/5 dark:text-text-secondary-dark">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas las filas visibles"
                    checked={allVisibleSelected}
                    onChange={() => onToggleSelectAll(pageRows.map(getRowId))}
                    className="h-3.5 w-3.5 rounded border-black/20 text-accent-600 focus:ring-accent-600 dark:border-white/20"
                  />
                </th>
              )}
              {columns.map(column => (
                <th key={column.key} className={`px-4 py-3 ${column.className ?? ''}`}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/5">
            {loading ? (
              Array.from({ length: 5 }, (_, rowIndex) => (
                <tr key={rowIndex}>
                  {selectable && (
                    <td className="px-4 py-3">
                      <div className="h-3.5 w-3.5 animate-pulse rounded bg-black/5 dark:bg-white/10" />
                    </td>
                  )}
                  {columns.map(column => (
                    <td key={column.key} className="px-4 py-3">
                      <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-black/5 dark:bg-white/10" />
                    </td>
                  ))}
                </tr>
              ))
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-6">
                  {emptyState}
                </td>
              </tr>
            ) : (
              pageRows.map(row => {
                const id = getRowId(row);
                const isSelected = Boolean(selectedIds?.has(id));
                return (
                  <tr
                    key={id}
                    onClick={() => onRowClick?.(row)}
                    className={`transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${
                      isSelected ? 'bg-accent-600/5' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                    }`}
                  >
                    {selectable && (
                      <td className="w-10 px-4 py-3" onClick={event => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label="Seleccionar fila"
                          checked={isSelected}
                          onChange={() => onToggleSelect(id)}
                          className="h-3.5 w-3.5 rounded border-black/20 text-accent-600 focus:ring-accent-600 dark:border-white/20"
                        />
                      </td>
                    )}
                    {columns.map(column => (
                      <td key={column.key} className={`px-4 py-3 ${column.className ?? ''}`}>
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </StackedTable>

      {!loading && rows.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/5 px-4 py-3 text-xs text-text-secondary-light dark:border-white/5 dark:text-text-secondary-dark">
          <span>
            Página {currentPage + 1} de {pageCount}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(current => Math.max(0, current - 1))}
              disabled={currentPage === 0}
              aria-label="Página anterior"
              className="rounded-lg p-1.5 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
            >
              <ChevronLeftIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPage(current => Math.min(pageCount - 1, current + 1))}
              disabled={currentPage >= pageCount - 1}
              aria-label="Página siguiente"
              className="rounded-lg p-1.5 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/5"
            >
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
