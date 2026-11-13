import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DevPreviewPanel from './DevPreviewPanel';

describe('DevPreviewPanel', () => {
  it('can start hidden and opens from the floating control', async () => {
    render(<DevPreviewPanel forceState="default" onSetForceState={() => {}} defaultOpen={false} />);
    expect(screen.queryByText(/vista previa.*solo desarrollo/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /mostrar herramientas/i }));
    expect(screen.getByText(/vista previa.*solo desarrollo/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /ocultar herramientas/i }));
    expect(screen.queryByText(/vista previa.*solo desarrollo/i)).not.toBeInTheDocument();
  });

  it('is labeled clearly as a development-only tool', () => {
    render(<DevPreviewPanel forceState="default" onSetForceState={() => {}} />);
    expect(screen.getByText(/vista previa.*solo desarrollo/i)).toBeInTheDocument();
  });

  it('offers no theme toggle', async () => {
    const onToggleTheme = vi.fn();
    const onSetForceState = vi.fn();
    // The OCC is dark only: a caller that still sends the old props gets no button for them.
    render(
      <DevPreviewPanel theme="dark" onToggleTheme={onToggleTheme} forceState="default" onSetForceState={onSetForceState} />
    );
    expect(screen.queryByRole('button', { name: /tema|claro|oscuro/i })).not.toBeInTheDocument();

    // Every button of the open panel forces a screen state; the floating control only folds it.
    const stateButtons = screen.getAllByRole('button').filter(button => !button.hasAttribute('aria-expanded'));
    for (const button of stateButtons) await userEvent.click(button);
    expect(onSetForceState).toHaveBeenCalledTimes(stateButtons.length);
    expect(onToggleTheme).not.toHaveBeenCalled();
  });

  it('calls onSetForceState with the matching state per button', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel forceState="default" onSetForceState={onSetForceState} />
    );
    await userEvent.click(screen.getByRole('button', { name: /carga/i }));
    expect(onSetForceState).toHaveBeenCalledWith('loading');

    await userEvent.click(screen.getByRole('button', { name: /flyaware caído/i }));
    expect(onSetForceState).toHaveBeenCalledWith('flyAwareError');

    await userEvent.click(screen.getByRole('button', { name: /sin aprobaciones/i }));
    expect(onSetForceState).toHaveBeenCalledWith('emptyApprovals');

    await userEvent.click(screen.getByRole('button', { name: /^normal$/i }));
    expect(onSetForceState).toHaveBeenCalledWith('default');
  });

  it('exposes the Planning-module forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel forceState="default" onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /planificación: sin vuelos/i }));
    expect(onSetForceState).toHaveBeenCalledWith('planningEmpty');

    await userEvent.click(screen.getByRole('button', { name: /planificación: sin resultados/i }));
    expect(onSetForceState).toHaveBeenCalledWith('planningNoResults');

    await userEvent.click(screen.getByRole('button', { name: /planificación: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('planningError');
  });

  it('exposes the Flight Monitoring forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel forceState="default" onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /monitoreo: sin vuelos/i }));
    expect(onSetForceState).toHaveBeenCalledWith('monitoringEmpty');

    await userEvent.click(screen.getByRole('button', { name: /monitoreo: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('monitoringError');

    await userEvent.click(screen.getByRole('button', { name: /monitoreo: flyaware desconectado/i }));
    expect(onSetForceState).toHaveBeenCalledWith('monitoringDisconnected');
  });

  it('exposes the Review-module forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel forceState="default" onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /revisión: sin operaciones/i }));
    expect(onSetForceState).toHaveBeenCalledWith('reviewEmpty');

    await userEvent.click(screen.getByRole('button', { name: /revisión: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('reviewError');
  });

  it('exposes the Reports-module forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel forceState="default" onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /reportes: sin datos/i }));
    expect(onSetForceState).toHaveBeenCalledWith('reportsEmpty');

    await userEvent.click(screen.getByRole('button', { name: /reportes: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('reportsError');
  });

  it('exposes the Notifications-module forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel forceState="default" onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /notificaciones: sin datos/i }));
    expect(onSetForceState).toHaveBeenCalledWith('notificationsEmpty');

    await userEvent.click(screen.getByRole('button', { name: /notificaciones: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('notificationsError');
  });

  it('exposes the Chat interno forced states', async () => {
    const onSetForceState = vi.fn();
    render(
      <DevPreviewPanel forceState="default" onSetForceState={onSetForceState} />
    );

    await userEvent.click(screen.getByRole('button', { name: /chat: sin conversaciones/i }));
    expect(onSetForceState).toHaveBeenCalledWith('chatEmpty');

    await userEvent.click(screen.getByRole('button', { name: /chat: error/i }));
    expect(onSetForceState).toHaveBeenCalledWith('chatError');

    await userEvent.click(screen.getByRole('button', { name: /chat: desconectado/i }));
    expect(onSetForceState).toHaveBeenCalledWith('chatDisconnected');
  });
});