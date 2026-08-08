import { ChevronDownIcon } from '../../dashboard/components/icons';

export default function ExpandableReportRow({ columns, row, expanded, onToggleExpand, renderExpanded, critical }) {
  return (
    <>
      <tr
        data-testid="report-table-row"
        onClick={renderExpanded ? () => onToggleExpand(row) : undefined}
        className={`border-t border-black/5 text-sm transition-colors duration-200 dark:border-white/5 ${
          renderExpanded ? 'cursor-pointer' : ''
        } ${critical ? 'bg-status-danger/[0.04] hover:bg-status-danger/[0.07]' : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'}`}
      >
        {renderExpanded && (
          <td className="w-8 px-3 py-2.5 text-text-secondary-light dark:text-text-secondary-dark">
            <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
          </td>
        )}
        {columns.map(column => (
          <td key={column.key} className={`px-3 py-2.5 text-ink-900 dark:text-text-primary-dark ${column.className ?? ''}`}>
            {column.render(row)}
          </td>
        ))}
      </tr>
      {renderExpanded && expanded && (
        <tr className="border-t border-black/5 dark:border-white/5">
          <td colSpan={columns.length + 1} className="bg-black/[0.015] px-5 py-4 dark:bg-white/[0.02]">
            {renderExpanded(row)}
          </td>
        </tr>
      )}
    </>
  );
}
