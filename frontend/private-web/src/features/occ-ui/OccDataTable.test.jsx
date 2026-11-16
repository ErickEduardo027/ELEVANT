import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { findLegacyColourClasses } from '../../styles/occLegacyBridge';
import OccDataTable, { OCC_ROW_TONES, OCC_TABLE_BREAKPOINTS, OCC_TABLE_KINDS } from './OccDataTable';
import OccEmptyState from './OccEmptyState';

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

// Synthetic turnarounds of one day at the station: identifiers and times are invented.
const FLIGHTS = Object.freeze([
  Object.freeze({ id: 'op-1', flight: 'ZZ9001', stand: 'A10', eta: '2026-11-14T14:40:00Z', agents: 2 }),
  Object.freeze({ id: 'op-2', flight: 'AA904', stand: 'A2', eta: '2026-11-14T13:05:00Z', agents: 0 }),
  Object.freeze({ id: 'op-3', flight: 'DL611', stand: null, eta: '2026-11-14T15:20:00Z', agents: 1 }),
]);

const COLUMNS = Object.freeze([
  { key: 'flight', header: 'Vuelo', mono: true, sortable: true },
  { key: 'stand', header: 'Posición', mono: true, sortable: true, render: row => row.stand ?? 'Sin posición' },
  {
    key: 'eta', header: 'Hora', mono: true, sortable: true, sortValue: row => Date.parse(row.eta),
    render: row => row.eta.slice(11, 16),
  },
  { key: 'agents', header: 'Agentes', align: 'end', hideBelow: 'md' },
]);

const classesOf = element => element.getAttribute('class').split(/\s+/).filter(Boolean);
const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const flightsOnScreen = () => bodyRows().map(row => within(row).getAllByRole('cell')[0].textContent);
const header = name => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) });

function table(props) {
  return <OccDataTable caption="Escalas de hoy" columns={COLUMNS} rows={FLIGHTS} {...props} />;
}

// A screen that keeps the chosen row, as Revisión keeps the chosen operation.
function Selectable({ onSelectRow, columns = COLUMNS, ...props }) {
  const [selected, setSelected] = useState(null);
  return table({
    columns, selectedId: selected, ...props,
    onSelectRow: (id, row) => { setSelected(id); onSelectRow?.(id, row); },
  });
}

describe('OccDataTable', () => {
  it('renders a real table with a caption and sticky sentence-case headers', () => {
    const { rerender } = render(table({ scrollClassName: 'max-h-96', className: 'h-full', 'data-testid': 'turnarounds' }));
    const grid = screen.getByRole('table', { name: 'Escalas de hoy' });
    expect(grid.tagName).toBe('TABLE');
    expect(grid.querySelector('caption')).toHaveClass('sr-only');
    expect(within(grid).getAllByRole('rowgroup').map(group => group.tagName)).toEqual(['THEAD', 'TBODY']);
    expect(bodyRows()).toHaveLength(3);

    const headers = within(grid).getAllByRole('columnheader');
    expect(headers.map(cell => cell.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col']);
    for (const cell of headers) {
      // Sticky over the scrolling body, on the panel slab with its joint; a label in sentence case.
      expect(classesOf(cell)).toEqual(expect.arrayContaining(['sticky', 'top-0', 'bg-occ-panel', 'border-b',
        'border-b-occ-line', 'text-xs', 'font-medium', 'text-occ-muted']));
      expect(classesOf(cell).filter(name => /uppercase|tracking|font-mono/.test(name))).toEqual([]);
      expect(findLegacyColourClasses(cell.className)).toEqual([]);
    }
    // The wrapper is the box that scrolls; the root takes className and the test id.
    expect(classesOf(grid.parentElement)).toEqual(expect.arrayContaining(['overflow-auto', 'max-h-96']));
    const root = screen.getByTestId('turnarounds');
    expect(root).toHaveAttribute('data-occ-table', 'table');
    expect(classesOf(root).at(-1)).toBe('h-full');

    // A header that does not sort is its text and nothing else (CanonicalReportsRoute.test compares them).
    rerender(<OccDataTable caption="Tiempos de turnaround" captionHidden={false}
      columns={[{ key: 'code', header: 'Operación' }, { key: 'minutes', header: 'Minutos reales', align: 'end' }]}
      rows={[{ id: 'r1', code: 'OP-1', minutes: 45 }]} />);
    expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Operación', 'Minutos reales']);
    expect(screen.getByRole('table', { name: 'Tiempos de turnaround' }).querySelector('caption')).not.toHaveClass('sr-only');
  });

  it('renders cells with render, mono, end alignment and hides columns below their breakpoint', () => {
    const seen = [];
    render(table({
      columns: [...COLUMNS, { key: 'index', header: 'Orden', render: (row, index) => { seen.push(index); return `#${index + 1}`; } }],
    }));
    const [first, second, third] = bodyRows();
    const cells = row => within(row).getAllByRole('cell');
    // `row[key]` by default, `render(row, index)` when given.
    expect(cells(first).map(cell => cell.textContent)).toEqual(['ZZ9001', 'A10', '14:40', '2', '#1']);
    expect(cells(third)[1]).toHaveTextContent('Sin posición');
    expect(seen).toEqual([0, 1, 2]);

    // Identifiers and times in IBM Plex Mono; their headers stay labels.
    expect(cells(first).slice(0, 3).every(cell => classesOf(cell).includes('font-mono'))).toBe(true);
    expect(classesOf(cells(first)[3])).not.toContain('font-mono');
    expect(classesOf(header('Vuelo'))).not.toContain('font-mono');
    // A number on the right with tabular figures, its header too.
    expect(classesOf(cells(first)[3])).toEqual(expect.arrayContaining(['text-right', 'tabular-nums']));
    expect(classesOf(header('Agentes'))).toContain('text-right');
    // Left out below 768 px, header and cells alike.
    for (const cell of [header('Agentes'), cells(first)[3], cells(second)[3]]) {
      expect(classesOf(cell)).toEqual(expect.arrayContaining(['hidden', 'md:table-cell']));
    }
    // Rows of 32 px (44 px on a touch screen), 1 px joints between them and none above the first.
    expect(classesOf(first)).toEqual(expect.arrayContaining(['h-8', '[@media(pointer:coarse)]:h-11']));
    expect(classesOf(cells(first)[1])).toEqual(expect.arrayContaining(['px-2', 'py-1.5']));
    expect(classesOf(cells(first)[1])).not.toContain('border-t');
    expect(classesOf(cells(second)[1])).toEqual(expect.arrayContaining(['border-t', 'border-t-occ-line']));
    // Not selectable: no stop for Tab, no selection state.
    expect(first).not.toHaveAttribute('tabindex');
    expect(first).not.toHaveAttribute('aria-selected');
    expect(OCC_TABLE_BREAKPOINTS).toEqual(['sm', 'md', 'lg', 'xl', '2xl']);
  });

  it('sorts a sortable column by sortValue and reports aria-sort', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    const { unmount } = render(table({ onSortChange }));
    expect(flightsOnScreen()).toEqual(['ZZ9001', 'AA904', 'DL611']);
    expect(screen.getAllByRole('columnheader').filter(cell => cell.hasAttribute('aria-sort'))).toEqual([]);
    // The header's button says what it does.
    const time = within(header('Hora')).getByRole('button');
    expect(time).toHaveAccessibleDescription('Ordenar por Hora');
    expect(time.querySelector('[data-sort]')).toHaveAttribute('data-sort', 'none');

    // By sortValue, the instant, not the text of the cell.
    await user.click(time);
    expect(flightsOnScreen()).toEqual(['AA904', 'ZZ9001', 'DL611']);
    expect(header('Hora')).toHaveAttribute('aria-sort', 'ascending');
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'eta', direction: 'asc' });
    expect(within(header('Hora')).getByRole('button')).toHaveAccessibleName(/^Hora.*orden ascendente$/);
    await user.click(within(header('Hora')).getByRole('button'));
    expect(flightsOnScreen()).toEqual(['DL611', 'ZZ9001', 'AA904']);
    expect(header('Hora')).toHaveAttribute('aria-sort', 'descending');

    // Codes in natural order (A2 before A10), a missing value last in both directions; one column at a time.
    await user.click(within(header('Posición')).getByRole('button'));
    expect(flightsOnScreen()).toEqual(['AA904', 'ZZ9001', 'DL611']);
    expect(header('Posición')).toHaveAttribute('aria-sort', 'ascending');
    expect(header('Hora')).not.toHaveAttribute('aria-sort');
    await user.click(within(header('Posición')).getByRole('button'));
    expect(flightsOnScreen()).toEqual(['ZZ9001', 'AA904', 'DL611']);
    // `index` is the row's place in `rows`, whatever the order on screen.
    unmount();

    // Controlled: the table shows `sort` and reports a click without reordering on its own.
    const controlled = vi.fn();
    render(table({ sort: { key: 'flight', direction: 'desc' }, onSortChange: controlled }));
    expect(flightsOnScreen()).toEqual(['ZZ9001', 'DL611', 'AA904']);
    expect(header('Vuelo')).toHaveAttribute('aria-sort', 'descending');
    await user.click(within(header('Vuelo')).getByRole('button'));
    expect(controlled).toHaveBeenCalledWith({ key: 'flight', direction: 'asc' });
    expect(flightsOnScreen()).toEqual(['ZZ9001', 'DL611', 'AA904']);
    cleanup();

    // In English inside a translated scope.
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope>{table({ columns: [{ key: 'eta', header: 'Time', sortable: true }] })}</LanguageScope>);
    expect(within(header('Time')).getByRole('button')).toHaveAccessibleDescription('Sort by Time');
  });

  it('selects a row on click, Enter and Space with aria-selected, and moves with the arrows, Home and End', async () => {
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    render(<Selectable onSelectRow={onSelectRow} />);
    const [first, second, third] = bodyRows();
    // One stop for Tab: the first row until one is chosen or focused.
    expect([first, second, third].map(row => row.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect([first, second, third].map(row => row.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false']);
    expect(classesOf(first)).toEqual(expect.arrayContaining(['cursor-pointer', 'hover:bg-occ-panel-raised']));

    await user.click(within(second).getByText('AA904'));
    expect(onSelectRow).toHaveBeenLastCalledWith('op-2', FLIGHTS[1]);
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(classesOf(second)).toContain('bg-occ-accent-soft');
    expect(classesOf(second)).not.toContain('hover:bg-occ-panel-raised');
    expect([first, second, third].map(row => row.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);

    // The arrows, Home and End move the focus without choosing; they keep the page from scrolling.
    second.focus();
    const down = createEvent.keyDown(second, { key: 'ArrowDown' });
    fireEvent(second, down);
    expect(down.defaultPrevented).toBe(true);
    expect(third).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(third).toHaveFocus();
    await user.keyboard('{Home}');
    expect(first).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(first).toHaveFocus();
    await user.keyboard('{End}');
    expect(third).toHaveFocus();
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(third).toHaveAttribute('tabindex', '0');

    // Enter and Space choose the focused row.
    await user.keyboard('{Enter}');
    expect(onSelectRow).toHaveBeenLastCalledWith('op-3', FLIGHTS[2]);
    expect(third).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{Home}');
    const space = createEvent.keyDown(first, { key: ' ' });
    fireEvent(first, space);
    expect(space.defaultPrevented).toBe(true);
    expect(first).toHaveAttribute('aria-selected', 'true');
    // A key with Ctrl or Meta belongs to the browser.
    const withControl = createEvent.keyDown(first, { key: 'End', ctrlKey: true });
    fireEvent(first, withControl);
    expect(withControl.defaultPrevented).toBe(false);
    expect(first).toHaveFocus();

    // Tab leaves the table from its one stop and comes back to it.
    await user.tab();
    expect(document.body).toHaveFocus();
    await user.tab({ shift: true });
    expect(first).toHaveFocus();
  });

  it('ignores keys that come from a control inside a row', async () => {
    const user = userEvent.setup();
    const onSelectRow = vi.fn();
    const onRelease = vi.fn();
    const columns = [
      ...COLUMNS.slice(0, 2),
      { key: 'code', header: 'Código', render: row => <input aria-label={`Código de ${row.flight}`} defaultValue={row.stand ?? ''} /> },
      { key: 'actions', header: '', render: row => <button type="button" onClick={() => onRelease(row.id)}>Liberar</button> },
    ];
    render(<Selectable onSelectRow={onSelectRow} columns={columns} />);
    const input = screen.getByRole('textbox', { name: 'Código de AA904' });
    await user.click(input);
    expect(onSelectRow).not.toHaveBeenCalled();
    // Typing, Space, Enter and the arrows stay with the field.
    await user.keyboard('{End} 7');
    expect(input).toHaveValue('A2 7');
    for (const key of ['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      const event = createEvent.keyDown(input, { key });
      fireEvent(input, event);
      expect(event.defaultPrevented, key).toBe(false);
      expect(input, key).toHaveFocus();
    }
    expect(onSelectRow).not.toHaveBeenCalled();

    // A press on a row's own button is that button's, not the row's.
    const [, second] = bodyRows();
    await user.click(within(second).getByRole('button', { name: 'Liberar' }));
    expect(onRelease).toHaveBeenCalledWith('op-2');
    expect(onSelectRow).not.toHaveBeenCalled();
    expect(second).toHaveAttribute('aria-selected', 'false');
    within(second).getByRole('button', { name: 'Liberar' }).focus();
    fireEvent.keyDown(within(second).getByRole('button', { name: 'Liberar' }), { key: 'Enter' });
    expect(onSelectRow).not.toHaveBeenCalled();
    // Elsewhere in the row a press still chooses it.
    await user.click(within(second).getByText('AA904'));
    expect(onSelectRow).toHaveBeenCalledWith('op-2', FLIGHTS[1]);
  });

  it('expands a row through a disclosure wired by aria-expanded and aria-controls, keeping it mounted while hidden', async () => {
    const user = userEvent.setup();
    const details = row => <p>{`Servicios de ${row.flight}`}</p>;
    const { unmount } = render(table({ renderExpanded: details }));
    const disclosures = screen.getAllByRole('button', { name: 'Mostrar detalle' });
    expect(disclosures).toHaveLength(3);
    const first = disclosures[0];
    // In the first cell of its row.
    expect(first.closest('td')).toBe(within(bodyRows()[0]).getAllByRole('cell')[0]);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(first.getAttribute('aria-controls'));
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('hidden');
    expect(panel).toHaveTextContent('Servicios de ZZ9001');
    // The detail is always there, so the text of the table does not change when it opens.
    const text = screen.getByRole('table').textContent;
    expect(text).toContain('Servicios de AA904');

    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(first).toHaveAccessibleName('Ocultar detalle');
    expect(panel).not.toHaveAttribute('hidden');
    expect(panel).toBeVisible();
    expect(screen.getByRole('table').textContent.replace(/Ocultar detalle/, 'Mostrar detalle')).toBe(text);
    // The detail spans the row and is not a row one can choose.
    expect(within(panel).getByRole('cell')).toHaveAttribute('colspan', '4');
    expect(panel).not.toHaveAttribute('data-occ-row');
    await user.click(first);
    expect(panel).toHaveAttribute('hidden');
    unmount();

    // Controlled, with a name of the screen's own, and as a list too.
    const onToggleExpanded = vi.fn();
    render(table({
      as: 'list', columns: COLUMNS.map(({ sortable, ...column }) => column), renderExpanded: details,
      expandedIds: ['op-2'], onToggleExpanded,
      expandLabel: (row, open) => `${open ? 'Ocultar' : 'Ver'} servicios de ${row.flight}`,
    }));
    const open = screen.getByRole('button', { name: 'Ocultar servicios de AA904' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(open.getAttribute('aria-controls'))).not.toHaveAttribute('hidden');
    const closed = screen.getByRole('button', { name: 'Ver servicios de ZZ9001' });
    expect(document.getElementById(closed.getAttribute('aria-controls'))).toHaveAttribute('hidden');
    await user.click(closed);
    expect(onToggleExpanded).toHaveBeenCalledWith('op-1', FLIGHTS[0]);
    // The screen decides: nothing opens until expandedIds says so.
    expect(closed).toHaveAttribute('aria-expanded', 'false');
    cleanup();

    act(() => resetLanguageForTests('en'));
    render(<LanguageScope>{table({ renderExpanded: details })}</LanguageScope>);
    expect(screen.getAllByRole('button', { name: 'Show details' })).toHaveLength(3);
  });

  it('shows the remote states through OccRemoteView and the empty state without rows', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(table({ status: 'loading', labels: { loading: 'Cargando las escalas…' } }));
    expect(screen.getByRole('status')).toHaveTextContent('Cargando las escalas…');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.querySelector('[data-occ-skeleton]')).not.toBeNull();

    rerender(table({ status: 'error', onRetry }));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar esta información.');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    rerender(table({ status: 'forbidden', onRetry }));
    expect(screen.getByText('No tienes permiso para ver esta información.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();

    // A success with no rows is the empty state, not an empty table.
    const empty = <OccEmptyState title="No hay escalas registradas para esta estación y fecha local." />;
    rerender(table({ rows: [], emptyState: empty, footer: <p>Página 1</p> }));
    expect(screen.getByText('No hay escalas registradas para esta estación y fecha local.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Página 1')).not.toBeInTheDocument();

    // A failed refresh keeps the rows, dimmed, under the stale note in the station's time.
    rerender(table({
      staleSince: '2026-11-14T18:32:00Z', timeZone: 'America/Santo_Domingo', onRetry, footer: <p>Página 1</p>,
    }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'La última actualización falló; se muestran los datos consultados a las 14:32.');
    expect(screen.getByRole('table').closest('[data-stale]')).not.toBeNull();
    // The footer goes under the rows.
    expect(screen.getByText('Página 1').closest('[data-occ-table-footer]')).not.toBeNull();
  });

  it('stacks into labelled cards with table-stack and data-label', () => {
    const columns = [
      ...COLUMNS,
      { key: 'status', header: <span>Estado</span>, label: 'Estado de la escala', render: () => 'Planificada' },
      { key: 'actions', header: <span aria-hidden="true">…</span>, render: () => 'Abrir' },
    ];
    const { rerender } = render(table({ columns }));
    const grid = screen.getByRole('table');
    expect(grid).toHaveClass('table-stack');
    const cells = within(bodyRows()[0]).getAllByRole('cell');
    // The text of each header labels its cell in a card; a header drawn as a node takes `label`, or none.
    expect(cells.map(cell => cell.getAttribute('data-label')))
      .toEqual(['Vuelo', 'Posición', 'Hora', 'Agentes', 'Estado de la escala', '']);

    rerender(table({ columns, stackBelow: false }));
    expect(screen.getByRole('table')).not.toHaveClass('table-stack');
    expect(within(bodyRows()[0]).getAllByRole('cell').some(cell => cell.hasAttribute('data-label'))).toBe(false);
  });

  it('a row with a tone gets the soft slab, the bar and its glyph', () => {
    const rowTone = row => {
      if (row.agents === 0) return 'attention';
      return row.stand === null ? 'urgent' : null;
    };
    const { unmount } = render(table({ rowTone }));
    const [calm, attention, urgent] = bodyRows();
    const firstCell = row => within(row).getAllByRole('cell')[0];

    expect(attention).toHaveAttribute('data-occ-tone', 'attention');
    expect(classesOf(attention)).toContain('bg-occ-warn-soft');
    expect(classesOf(firstCell(attention))).toEqual(expect.arrayContaining(['border-l-[3px]', 'border-l-occ-warn']));
    // Never the colour alone: the triangle with its word, in the first cell.
    expect(within(firstCell(attention)).getByRole('img', { name: 'Atención' })).toHaveAttribute('data-shape', 'triangle');

    expect(urgent).toHaveAttribute('data-occ-tone', 'urgent');
    expect(classesOf(urgent)).toContain('bg-occ-danger-soft');
    expect(classesOf(firstCell(urgent))).toContain('border-l-occ-danger');
    expect(within(firstCell(urgent)).getByRole('img', { name: 'Urgente' })).toHaveAttribute('data-shape', 'octagon');

    // A calm row keeps the bar's room, unlit, and has no slab and no glyph.
    expect(calm).not.toHaveAttribute('data-occ-tone');
    expect(classesOf(firstCell(calm))).toEqual(expect.arrayContaining(['border-l-[3px]', 'border-l-transparent']));
    expect(classesOf(calm).filter(name => name.startsWith('bg-'))).toEqual([]);
    expect(within(calm).queryByRole('img')).not.toBeInTheDocument();
    // The cells of the other columns carry no bar.
    expect(classesOf(within(attention).getAllByRole('cell')[1])).not.toContain('border-l-[3px]');
    unmount();

    // A chosen row shows the selection; the bar and the glyph keep the signal.
    render(<Selectable rowTone={rowTone} />);
    fireEvent.click(within(bodyRows()[1]).getByText('AA904'));
    const chosen = bodyRows()[1];
    expect(classesOf(chosen)).toContain('bg-occ-accent-soft');
    expect(classesOf(chosen)).not.toContain('bg-occ-warn-soft');
    expect(within(chosen).getByRole('img', { name: 'Atención' })).toBeInTheDocument();
    cleanup();

    act(() => resetLanguageForTests('en'));
    render(<LanguageScope>{table({ rowTone })}</LanguageScope>);
    expect(screen.getByRole('img', { name: 'Attention' })).toBeInTheDocument();
    expect(OCC_ROW_TONES).toEqual(['attention', 'urgent']);
  });

  it('as list renders a named list of items with hidden-header cell labels and refuses selection', async () => {
    const onRelease = vi.fn();
    const coverages = [
      { id: 'cov-1', agent: 'Ana Pérez', stands: 'A1 · A2', window: '06:00–14:00' },
      { id: 'cov-2', agent: 'Luis Gómez', stands: 'B21', window: '14:00–22:00' },
    ];
    const columns = [
      { key: 'agent', header: 'Agente', width: '12rem' },
      { key: 'stands', header: 'Posiciones', mono: true, width: '8rem' },
      { key: 'window', header: 'Turno', mono: true, hideBelow: 'lg' },
      { key: 'actions', header: '', render: row => <button type="button" onClick={() => onRelease(row.id)}>Liberar</button> },
    ];
    render(<section aria-label="Coberturas del día">
      <OccDataTable as="list" caption="Agentes asignados" columns={columns} rows={coverages} data-testid="coverages" />
    </section>);
    const list = screen.getByRole('list', { name: 'Agentes asignados' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByTestId('coverages')).toHaveAttribute('data-occ-table', 'list');

    // What the cycle E2E reads: the item of an agent, with its own «Liberar».
    const row = within(screen.getByRole('region', { name: 'Coberturas del día' })).getAllByRole('listitem')
      .find(item => item.textContent.includes('Luis Gómez'));
    await userEvent.click(within(row).getByRole('button', { name: 'Liberar' }));
    expect(onRelease).toHaveBeenCalledWith('cov-2');

    // Each cell starts with its label for screen readers, never in the middle of its content.
    const cells = [...items[0].querySelectorAll('[data-occ-row] > div > div')];
    expect(cells.map(cell => cell.textContent)).toEqual(['Agente: Ana Pérez', 'Posiciones: A1 · A2', 'Turno: 06:00–14:00',
      'Liberar']);
    // On view only as a stacked label below 640 px; read out as «Agente:» from there.
    expect(classesOf(cells[0].firstElementChild)).toEqual(expect.arrayContaining(['block', 'sm:sr-only']));
    expect(classesOf(cells[1])).toContain('font-mono');
    expect(classesOf(cells[2])).toEqual(expect.arrayContaining(['hidden', 'lg:block']));

    // The header line shows the columns and is hidden from assistive technology.
    const head = document.querySelector('[data-occ-list-header]');
    expect(head).toHaveAttribute('aria-hidden', 'true');
    expect([...head.children].map(cell => cell.textContent)).toEqual(['Agente', 'Posiciones', 'Turno', '']);
    expect(classesOf(head)).toEqual(expect.arrayContaining(['hidden', 'sm:grid']));
    // The same 14 px text as a table; one grid template per breakpoint, where a column left out below lg takes no track.
    const wrapper = screen.getByTestId('coverages').querySelector('[style]');
    expect(classesOf(wrapper)).toEqual(expect.arrayContaining(['text-sm', 'text-occ-text']));
    const templates = wrapper.style;
    expect(templates.getPropertyValue('--list-cols')).toBe('minmax(0,1fr)');
    expect(templates.getPropertyValue('--list-cols-md')).toBe('12rem 8rem minmax(0,1fr)');
    expect(templates.getPropertyValue('--list-cols-lg')).toBe('12rem 8rem minmax(0,1fr) minmax(0,1fr)');

    // A list takes no selection and no sorting.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccDataTable as="list" columns={columns} rows={coverages} onSelectRow={() => {}} />))
        .toThrow(TypeError);
      expect(() => render(<OccDataTable as="list" columns={columns} rows={coverages} sort={{ key: 'agent', direction: 'asc' }} />))
        .toThrow(TypeError);
      expect(() => render(<OccDataTable as="list" columns={[{ key: 'agent', header: 'Agente', sortable: true }]}
        rows={coverages} />)).toThrow(TypeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('throws on an unknown alignment, breakpoint, kind or tone', () => {
    expect(OCC_TABLE_KINDS).toEqual(['table', 'list']);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(table({ columns: [{ key: 'flight', header: 'Vuelo', align: 'center' }] })))
        .toThrow(/Unknown OCC table alignment: center/);
      expect(() => render(table({ columns: [{ key: 'flight', header: 'Vuelo', hideBelow: '3xl' }] })))
        .toThrow(/Unknown OCC table breakpoint: 3xl/);
      expect(() => render(table({ as: 'grid' }))).toThrow(/Unknown OCC table kind: grid/);
      // `critical` is the design's word; the vocabulary says `urgent`.
      expect(() => render(table({ rowTone: () => 'critical' }))).toThrow(/Unknown OCC row tone: critical/);
      expect(() => render(table({ sort: { key: 'flight', direction: 'up' } }))).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
