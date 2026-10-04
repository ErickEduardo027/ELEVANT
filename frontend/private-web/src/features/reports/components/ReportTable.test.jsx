import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportTable from './ReportTable';

const COLUMNS = [
  { key: 'name', label: 'Nombre', sortValue: row => row.name, render: row => row.name },
  { key: 'value', label: 'Valor', sortValue: row => row.value, render: row => row.value },
];

function buildRows(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, name: `Item ${index}`, value: count - index }));
}

describe('ReportTable', () => {
  it('shows the empty state when there are no rows', () => {
    render(<ReportTable columns={COLUMNS} rows={[]} getSearchableText={row => row.name} emptyMessage="Sin datos" />);
    expect(screen.getByText('Sin datos')).toBeInTheDocument();
  });

  it('renders every row within the first page', () => {
    render(<ReportTable columns={COLUMNS} rows={buildRows(3)} getSearchableText={row => row.name} />);
    expect(screen.getAllByTestId('report-table-row')).toHaveLength(3);
  });

  it('filters rows via the search box', async () => {
    render(<ReportTable columns={COLUMNS} rows={buildRows(3)} getSearchableText={row => row.name} />);
    await userEvent.type(screen.getByPlaceholderText('Buscar…'), 'Item 1');
    expect(screen.getAllByTestId('report-table-row')).toHaveLength(1);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
  });

  it('shows a distinct message when the search matches nothing', async () => {
    render(<ReportTable columns={COLUMNS} rows={buildRows(3)} getSearchableText={row => row.name} />);
    await userEvent.type(screen.getByPlaceholderText('Buscar…'), 'nope');
    expect(screen.getByText('Ninguna fila coincide con la búsqueda.')).toBeInTheDocument();
  });

  it('sorts rows by a sortable column and toggles direction on repeat clicks', async () => {
    render(<ReportTable columns={COLUMNS} rows={buildRows(3)} getSearchableText={row => row.name} />);
    await userEvent.click(screen.getByRole('button', { name: 'Valor' }));

    let cells = screen.getAllByTestId('report-table-row').map(row => row.textContent);
    expect(cells[0]).toContain('Item 2'); // value 1 is smallest -> ascending first

    await userEvent.click(screen.getByRole('button', { name: /valor/i }));
    cells = screen.getAllByTestId('report-table-row').map(row => row.textContent);
    expect(cells[0]).toContain('Item 0'); // value 3 is largest -> descending first
  });

  it('paginates beyond ten rows', async () => {
    render(<ReportTable columns={COLUMNS} rows={buildRows(12)} getSearchableText={row => row.name} />);
    expect(screen.getAllByTestId('report-table-row')).toHaveLength(10);
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getAllByTestId('report-table-row')).toHaveLength(2);
  });

  it('expands a row to show its detail panel and collapses it again', async () => {
    render(
      <ReportTable
        columns={COLUMNS}
        rows={buildRows(2)}
        getSearchableText={row => row.name}
        renderExpanded={row => <div data-testid="expanded-detail">Detalle de {row.name}</div>}
      />
    );
    expect(screen.queryByTestId('expanded-detail')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByTestId('report-table-row')[0]);
    expect(screen.getByText('Detalle de Item 0')).toBeInTheDocument();

    await userEvent.click(screen.getAllByTestId('report-table-row')[0]);
    expect(screen.queryByTestId('expanded-detail')).not.toBeInTheDocument();
  });

  it('applies a critical highlight class when isCriticalRow returns true', () => {
    render(
      <ReportTable
        columns={COLUMNS}
        rows={buildRows(1)}
        getSearchableText={row => row.name}
        isCriticalRow={() => true}
      />
    );
    expect(screen.getByTestId('report-table-row').className).toMatch(/status-danger/);
  });
});