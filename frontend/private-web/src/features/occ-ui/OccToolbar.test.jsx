import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OccButton from './OccButton';
import OccSegmented from './OccSegmented';
import OccToolbar from './OccToolbar';

afterEach(cleanup);

const classesOf = element => element.className.split(/\s+/).filter(Boolean);

describe('OccToolbar', () => {
  it('renders the page h1 from title and a named toolbar with controls before actions', () => {
    const { rerender } = render(
      <OccToolbar title="Cobertura de posiciones" summary="3 agentes cubriendo"
        actions={<OccButton variant="primary">Asignar posiciones</OccButton>}>
        <OccSegmented label="Terminal y vista" value="A" options={[{ id: 'A', label: 'Terminal A' },
          { id: 'B', label: 'Terminal B' }]} />
        <label>Fecha <input type="date" defaultValue="2026-11-14" /></label>
      </OccToolbar>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Cobertura de posiciones' });
    expect(classesOf(heading)).toEqual(expect.arrayContaining(['text-base', 'font-semibold', 'text-occ-text']));
    // The summary shares the title's line; nothing sits above the title and no paragraph explains the page.
    const titleLine = heading.parentElement;
    expect(within(titleLine).getByText('3 agentes cubriendo')).toHaveClass('text-occ-muted');
    expect(titleLine.firstElementChild).toBe(heading);
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();

    // One toolbar, named by the title, that does not hold the h1.
    const toolbar = screen.getByRole('toolbar', { name: 'Cobertura de posiciones' });
    expect(toolbar.contains(heading)).toBe(false);
    // It wraps, and a labelled field sits level with the buttons: the controls line up on their bottom edge.
    expect(classesOf(toolbar)).toEqual(expect.arrayContaining(['flex-wrap', 'items-end']));
    // Controls first, the actions last and pushed to the end of the line.
    const segmented = within(toolbar).getByRole('group', { name: 'Terminal y vista' });
    const date = within(toolbar).getByLabelText('Fecha');
    const action = within(toolbar).getByRole('button', { name: 'Asignar posiciones' });
    expect(segmented.compareDocumentPosition(date) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(date.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(action.parentElement).toHaveClass('ml-auto');
    expect(toolbar.lastElementChild).toBe(action.parentElement);

    // `label` names the toolbar when the controls scope something narrower than the page.
    rerender(<OccToolbar title="Reportes" label="Reporte y período"><button type="button">Generar</button></OccToolbar>);
    expect(screen.getByRole('toolbar', { name: 'Reporte y período' })).toBeInTheDocument();
    // With nothing to hold there is no toolbar, only the title.
    rerender(<OccToolbar title="Notificaciones" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Notificaciones' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });

  it('forwards data-testid and className', () => {
    render(<OccToolbar title="Tablets" data-testid="devices-toolbar" className="px-4 py-3"
      actions={<OccButton>Actualizar</OccButton>} />);
    const bar = screen.getByTestId('devices-toolbar');
    expect(bar.tagName).toBe('HEADER');
    expect(bar).toHaveAttribute('data-occ-toolbar');
    expect(classesOf(bar).slice(-2)).toEqual(['px-4', 'py-3']);
    // Actions alone still make a toolbar.
    expect(within(bar).getByRole('toolbar', { name: 'Tablets' })).toContainElement(screen.getByRole('button', { name: 'Actualizar' }));
  });

  it('gives the h1 the id a page section names itself by, and none without titleId', () => {
    const { rerender } = render(
      <section aria-labelledby="ready-contracts-title">
        <OccToolbar title="Contratos listos para operar" titleId="ready-contracts-title" />
      </section>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Contratos listos para operar' });
    expect(heading).toHaveAttribute('id', 'ready-contracts-title');
    expect(screen.getByRole('region', { name: 'Contratos listos para operar' })).toContainElement(heading);
    rerender(<OccToolbar title="Reportes operativos" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Reportes operativos' })).not.toHaveAttribute('id');
  });
});
