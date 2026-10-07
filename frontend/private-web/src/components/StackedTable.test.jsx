import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import StackedTable from './StackedTable';

function Table() {
  const [rows, setRows] = useState([['PUJ', 'Activo']]);
  return (
    <>
      <button type="button" onClick={() => setRows(current => [...current, ['SDQ', 'Inactivo']])}>Agregar</button>
      <StackedTable>
        <table className="table-stack">
          <thead><tr><th>Estación</th><th>Estado</th></tr></thead>
          <tbody>
            {rows.map(([code, status]) => <tr key={code}><td>{code}</td><td>{status}</td></tr>)}
            <tr><td colSpan={2}>Fin del listado</td></tr>
          </tbody>
        </table>
      </StackedTable>
    </>
  );
}

it('labels every cell from its column header, including rows added later', async () => {
  const { getByText } = render(<Table />);
  expect(getByText('PUJ')).toHaveAttribute('data-label', 'Estación');
  expect(getByText('Activo')).toHaveAttribute('data-label', 'Estado');
  expect(getByText('Fin del listado')).toHaveAttribute('data-label', '');

  await userEvent.click(getByText('Agregar'));
  await waitFor(() => expect(getByText('Inactivo')).toHaveAttribute('data-label', 'Estado'));
});

it('keeps an explicit data-label chosen by the page', () => {
  const { getByText } = render(
    <StackedTable>
      <table className="table-stack">
        <thead><tr><th>Columna</th></tr></thead>
        <tbody><tr><td data-label="Propia">Valor</td></tr></tbody>
      </table>
    </StackedTable>,
  );
  expect(getByText('Valor')).toHaveAttribute('data-label', 'Propia');
});
