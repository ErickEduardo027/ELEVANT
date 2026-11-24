import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MapSidePanel, { MAP_SIDE_PANEL_LAYOUT, MapSidePanelSection } from './MapSidePanel';

afterEach(cleanup);

const classesOf = element => element.className.split(/\s+/).filter(Boolean);

describe('MapSidePanel', () => {
  it('is a named landmark, never a dialog, with its header, a body that scrolls and a footer in sight', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MapSidePanel label="Detalle del vuelo ZZ9001" title={<span>ZZ9001</span>} subtitle={<span>Llegada desde JFK</span>}
        status={<span>En operación</span>} onClose={onClose} closeLabel="Cerrar detalle" data-testid="panel"
        footer={<a href="/admin-occ/planning">Ver planificación</a>}>
        <MapSidePanelSection title="Horarios" meta={<span data-meta="">+12</span>}><p>16:20</p></MapSidePanelSection>
      </MapSidePanel>,
    );
    const panel = screen.getByRole('complementary', { name: 'Detalle del vuelo ZZ9001' });
    expect(panel).toBe(screen.getByTestId('panel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('ZZ9001');
    expect(panel).toHaveTextContent('Llegada desde JFK');
    expect(panel).toHaveTextContent('En operación');
    // A section: its heading in sentence case, its meta beside it and outside it, so the heading keeps its name.
    const section = within(panel).getByRole('region', { name: 'Horarios' });
    expect(within(section).getByRole('heading', { level: 3 })).toHaveTextContent(/^Horarios$/);
    expect(within(section).getByRole('heading', { level: 3 }).className).not.toMatch(/uppercase|tracking/);
    expect(section.querySelector('[data-meta]')).toHaveTextContent('+12');
    // The body scrolls on its own and the footer stays under it.
    const body = panel.querySelector('[data-map-side-panel-body]');
    expect(classesOf(body)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']));
    expect(panel.querySelector('[data-map-side-panel-footer]')).toHaveTextContent('Ver planificación');
    await user.click(within(panel).getByRole('button', { name: 'Cerrar detalle' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('docks framed in a column or flush against the map, on the opaque panel slab, flat', () => {
    expect(Object.keys(MAP_SIDE_PANEL_LAYOUT)).toEqual(['framed', 'flush']);
    const { rerender } = render(<MapSidePanel label="Detalle">x</MapSidePanel>);
    const panel = screen.getByRole('complementary', { name: 'Detalle' });
    expect(panel).toHaveAttribute('data-map-side-panel', 'framed');
    expect(classesOf(panel)).toEqual(expect.arrayContaining(['bg-occ-panel', 'rounded-md', 'border', 'border-occ-line']));
    expect(panel.className).not.toMatch(/shadow|blur|panel-float|absolute/);
    // Without onClose there is no «Cerrar»; without a footer, no footer.
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument();
    expect(panel.querySelector('[data-map-side-panel-footer]')).toBeNull();
    rerender(<MapSidePanel label="Detalle" variant="flush" as="section">x</MapSidePanel>);
    const flush = screen.getByRole('region', { name: 'Detalle' });
    expect(flush).toHaveAttribute('data-map-side-panel', 'flush');
    expect(classesOf(flush)).toEqual(expect.arrayContaining(['border-l', 'border-occ-line']));
    expect(classesOf(flush)).not.toContain('rounded-md');
  });

  it('throws without a label, or with an unknown variant or heading level', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<MapSidePanel label="">x</MapSidePanel>)).toThrow(TypeError);
      expect(() => render(<MapSidePanel label="Detalle" variant="floating">x</MapSidePanel>)).toThrow(RangeError);
      expect(() => render(<MapSidePanel label="Detalle" headingLevel={5}>x</MapSidePanel>)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
