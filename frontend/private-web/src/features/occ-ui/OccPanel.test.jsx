import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccPanel, { OCC_PANEL_STATUSES, OccRemoteView, panelStateOf } from './OccPanel';
import OccSkeleton from './OccSkeleton';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

// Punta Cana is UTC−4: data read at 18:32 UTC was read at 14:32 at the station.
const ZONE = 'America/Santo_Domingo';
const FETCHED_AT = '2026-11-14T18:32:00Z';
const STALE_TEXT = 'La última actualización falló; se muestran los datos consultados a las 14:32.';

function Board() {
  return <ul aria-label="Llegadas"><li>ZZ9001</li><li>AA904</li></ul>;
}

// A body that keeps a state of its own, like a board with its chosen tab.
function Counter() {
  const [count, setCount] = useState(0);
  return <button type="button" onClick={() => setCount(value => value + 1)}>{`Vistas ${count}`}</button>;
}

describe('OccPanel', () => {
  it('is a region named by its title, with its meta and actions', () => {
    const { rerender } = render(
      <OccPanel title="Tablero" meta="4 llegadas" actions={<a href="/admin-occ/planning">Abrir planificación</a>}
        className="h-full" data-testid="board-panel">
        <Board />
      </OccPanel>,
    );
    const region = screen.getByRole('region', { name: 'Tablero' });
    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveAttribute('data-testid', 'board-panel');
    expect(screen.getByRole('heading', { level: 2, name: 'Tablero' }).id).toBe(region.getAttribute('aria-labelledby'));
    expect(within(region).getByText('4 llegadas')).toHaveClass('text-occ-muted');
    expect(within(region).getByRole('link', { name: 'Abrir planificación' })).toBeInTheDocument();
    expect(within(region).getByRole('list', { name: 'Llegadas' })).toBeInTheDocument();
    // The flat panel slab: a 1 px joint and the 6 px panel radius, no shadow; className last.
    const classes = region.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['bg-occ-panel', 'border-occ-line', 'rounded-md']));
    expect(classes.filter(name => /shadow|blur/.test(name))).toEqual([]);
    expect(classes.at(-1)).toBe('h-full');

    // Inside another section the title is an h3.
    rerender(<OccPanel title="Pendientes de la jornada" headingLevel={3}><Board /></OccPanel>);
    expect(screen.getByRole('heading', { level: 3, name: 'Pendientes de la jornada' })).toBeInTheDocument();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccPanel title="Tablero" headingLevel={1}><Board /></OccPanel>)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('shows a skeleton on the first load (idle and loading) and never a zero', () => {
    for (const status of ['idle', 'loading']) {
      const { unmount } = render(<OccPanel title="Cifras de la jornada" status={status}><p>Escalas 0</p></OccPanel>);
      const region = screen.getByRole('region', { name: 'Cifras de la jornada' });
      expect(within(region).getByRole('status')).toHaveTextContent('Cargando…');
      expect(region.querySelector('[data-occ-skeleton]')).not.toBeNull();
      // The body is not drawn: no figure, and no zero, until the read answers.
      expect(within(region).queryByText('Escalas 0')).not.toBeInTheDocument();
      expect(region.textContent).not.toMatch(/\b0\b/);
      unmount();
    }
    // A panel draws the shape of what is coming.
    render(
      <OccPanel title="Cifras de la jornada" status="loading" skeleton={<OccSkeleton variant="tiles" rows={6} />}>
        <p>Escalas 18</p>
      </OccPanel>,
    );
    expect(document.querySelector('[data-occ-skeleton="tiles"]')).not.toBeNull();
  });

  it('renders its children once the read succeeds and its empty state when the read comes back empty', () => {
    const { rerender } = render(<OccPanel title="Tablero" status="success"><Board /></OccPanel>);
    const region = screen.getByRole('region', { name: 'Tablero' });
    expect(within(region).getByRole('list', { name: 'Llegadas' })).toBeInTheDocument();
    expect(within(region).queryByRole('status')).not.toBeInTheDocument();
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument();
    expect(region.querySelector('[data-stale]')).toBeNull();

    // Empty: one sentence by default, or the panel's own empty state.
    rerender(<OccPanel title="Tablero" status="empty"><Board /></OccPanel>);
    expect(within(region).queryByRole('list')).not.toBeInTheDocument();
    expect(within(region).getByText('No hay datos para mostrar.')).toBeInTheDocument();
    rerender(
      <OccPanel title="Tablero" status="empty"
        emptyState={<p>No hay escalas registradas para esta estación y fecha local.</p>}>
        <Board />
      </OccPanel>,
    );
    expect(within(region).getByText('No hay escalas registradas para esta estación y fecha local.')).toBeInTheDocument();
    expect(within(region).queryByText('No hay datos para mostrar.')).not.toBeInTheDocument();
    // Without a status it simply frames its content.
    rerender(<OccPanel title="Tablero"><Board /></OccPanel>);
    expect(within(region).getByRole('list', { name: 'Llegadas' })).toBeInTheDocument();
  });

  it("offers «Reintentar» after a failed or timed-out read, with a fixed text and never the server's", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    // Whatever a caller hands over from the failed read, the panel has nowhere to show it.
    const serverError = { error: new Error('SQL password=secret'), problem: { title: 'Internal Server Error' } };
    const { rerender } = render(<OccPanel title="Alertas" status="error" onRetry={onRetry} {...serverError}><Board /></OccPanel>);
    const region = screen.getByRole('region', { name: 'Alertas' });
    expect(within(region).getByRole('alert')).toHaveTextContent('No se pudo cargar esta información.');
    expect(region.textContent).not.toMatch(/password|secret|Internal Server Error/);
    expect(within(region).queryByRole('list')).not.toBeInTheDocument();
    await user.click(within(region).getByRole('button', { name: 'Reintentar' }));
    // The retry hears no click event of its own.
    expect(onRetry).toHaveBeenCalledExactlyOnceWith();

    rerender(<OccPanel title="Alertas" status="timeout" onRetry={onRetry}><Board /></OccPanel>);
    expect(within(region).getByRole('alert'))
      .toHaveTextContent('La consulta tardó demasiado. Comprueba la conexión y vuelve a intentarlo.');
    await user.click(within(region).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(2);

    // Without a way to retry there is no button.
    rerender(<OccPanel title="Alertas" status="error"><Board /></OccPanel>);
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the no-permission state after a 401 or a 403 and offers no retry', () => {
    for (const status of ['forbidden', 'unauthorized']) {
      const { unmount } = render(<OccPanel title="Posiciones" status={status} onRetry={vi.fn()}><Board /></OccPanel>);
      const region = screen.getByRole('region', { name: 'Posiciones' });
      expect(within(region).getByText('No tienes permiso para ver esta información.')).toBeInTheDocument();
      // A steady state, not an error: no alert, no retry, and nothing of the data.
      expect(within(region).queryByRole('alert')).not.toBeInTheDocument();
      expect(within(region).queryByRole('button')).not.toBeInTheDocument();
      expect(within(region).queryByRole('list')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('keeps the last data dimmed with «La última actualización falló; se muestran los datos consultados a las 14:32.» when a refresh fails', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<OccPanel title="Tablero" status="success" timeZone={ZONE}><Counter /></OccPanel>);
    await user.click(screen.getByRole('button', { name: 'Vistas 0' }));
    expect(screen.getByRole('button', { name: 'Vistas 1' })).toBeInTheDocument();

    rerender(
      <OccPanel title="Tablero" status="success" staleSince={FETCHED_AT} onRetry={onRetry} timeZone={ZONE}>
        <Counter />
      </OccPanel>,
    );
    const region = screen.getByRole('region', { name: 'Tablero' });
    // Said politely, once: a status note, not an alert.
    expect(within(region).getByRole('status')).toHaveTextContent(STALE_TEXT);
    expect(within(region).queryByRole('alert')).not.toBeInTheDocument();
    // The data stays, dimmed, and keeps its own state: the body never remounts.
    const stale = region.querySelector('[data-stale]');
    expect(stale).toHaveClass('opacity-70');
    expect(within(stale).getByRole('button', { name: 'Vistas 1' })).toBeInTheDocument();
    expect(within(region).getByRole('status').closest('[data-stale]')).toBeNull();
    await user.click(within(region).getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();

    // An empty read that failed to refresh says so too.
    rerender(<OccPanel title="Tablero" status="empty" staleSince={FETCHED_AT} timeZone={ZONE}><Counter /></OccPanel>);
    expect(within(region).getByRole('status')).toHaveTextContent(STALE_TEXT);
    expect(region.querySelector('[data-stale]')).toHaveTextContent('No hay datos para mostrar.');

    // Once a refresh succeeds the note goes and the data is bright again.
    rerender(<OccPanel title="Tablero" status="success" timeZone={ZONE}><Counter /></OccPanel>);
    expect(within(region).queryByRole('status')).not.toBeInTheDocument();
    expect(region.querySelector('[data-stale]')).toBeNull();
  });

  it('panelStateOf maps a useOccResource view to status, staleSince and onRetry', () => {
    const retry = vi.fn();
    expect(panelStateOf({ status: 'success', data: [], refreshing: false, refreshFailed: true, fetchedAt: FETCHED_AT, retry }))
      .toEqual({ status: 'success', staleSince: FETCHED_AT, onRetry: retry });
    expect(panelStateOf({ status: 'success', data: [], refreshing: true, refreshFailed: false, fetchedAt: FETCHED_AT, retry }))
      .toEqual({ status: 'success', staleSince: null, onRetry: retry });
    expect(panelStateOf({ status: 'forbidden', data: null, refreshFailed: false, fetchedAt: null, retry }))
      .toEqual({ status: 'forbidden', staleSince: null, onRetry: retry });
    // Before the hook answers there is nothing yet.
    expect(panelStateOf(undefined)).toEqual({ status: 'idle', staleSince: null, onRetry: undefined });

    // The view goes straight into a panel.
    render(
      <OccPanel title="Tablero" timeZone={ZONE}
        {...panelStateOf({ status: 'success', refreshFailed: true, fetchedAt: FETCHED_AT, retry })}>
        <Board />
      </OccPanel>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(STALE_TEXT);
  });

  it('takes per-panel labels, speaks English inside the scope and Spanish outside, and rejects an unknown status', () => {
    expect(OCC_PANEL_STATUSES).toEqual(['idle', 'loading', 'success', 'empty', 'error', 'timeout', 'forbidden', 'unauthorized']);
    // The exact texts a screen already shows stay the same.
    const labels = {
      loading: 'Cargando panorama operativo…',
      error: 'No se pudo cargar el panorama operativo de la estación.',
      unauthorized: 'La sesión expiró. Vuelva a iniciar sesión.',
      stale: 'Datos de las {time}.',
    };
    const { rerender } = render(<OccRemoteView status="loading" labels={labels}><Board /></OccRemoteView>);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando panorama operativo…');
    rerender(<OccRemoteView status="error" labels={labels} onRetry={vi.fn()}><Board /></OccRemoteView>);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el panorama operativo de la estación.');
    rerender(<OccRemoteView status="unauthorized" labels={labels}><Board /></OccRemoteView>);
    expect(screen.getByText('La sesión expiró. Vuelva a iniciar sesión.')).toBeInTheDocument();
    // A label for one refusal leaves the other with the default.
    rerender(<OccRemoteView status="forbidden" labels={labels}><Board /></OccRemoteView>);
    expect(screen.getByText('No tienes permiso para ver esta información.')).toBeInTheDocument();
    rerender(<OccRemoteView status="success" staleSince={FETCHED_AT} timeZone={ZONE} labels={labels}><Board /></OccRemoteView>);
    expect(screen.getByRole('status')).toHaveTextContent('Datos de las 14:32.');
    cleanup();

    // Outside a language scope it is always Spanish, whatever the account chose.
    resetLanguageForTests('en');
    render(<OccRemoteView status="error" onRetry={vi.fn()}><Board /></OccRemoteView>);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar esta información.');
    cleanup();
    render(
      <LanguageScope>
        <OccPanel title="Board" status="success" staleSince={FETCHED_AT} timeZone={ZONE} onRetry={vi.fn()}><Board /></OccPanel>
      </LanguageScope>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('The last refresh failed; showing data retrieved at 14:32.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    cleanup();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccPanel title="Tablero" status="ready"><Board /></OccPanel>)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
