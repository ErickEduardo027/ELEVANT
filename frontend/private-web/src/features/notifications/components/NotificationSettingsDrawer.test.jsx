import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationSettingsDrawer from './NotificationSettingsDrawer';

const PREFERENCES = { operational: 'show', review: 'show', system: 'mute', personal: 'show', general: 'show' };

describe('NotificationSettingsDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <NotificationSettingsDrawer open={false} preferences={PREFERENCES} onTogglePreference={() => {}} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a row per category with the current preference highlighted', () => {
    render(
      <NotificationSettingsDrawer open preferences={PREFERENCES} onTogglePreference={() => {}} onClose={() => {}} />
    );
    expect(screen.getByText('Operativas')).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
  });

  it('calls onTogglePreference with the flipped value', async () => {
    const onTogglePreference = vi.fn();
    render(
      <NotificationSettingsDrawer open preferences={PREFERENCES} onTogglePreference={onTogglePreference} onClose={() => {}} />
    );

    const systemRow = screen.getByText('Sistema').closest('div');
    await userEvent.click(within(systemRow).getByRole('button', { name: 'Mostrar' }));
    expect(onTogglePreference).toHaveBeenCalledWith('system', 'show');
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<NotificationSettingsDrawer open preferences={PREFERENCES} onTogglePreference={() => {}} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<NotificationSettingsDrawer open preferences={PREFERENCES} onTogglePreference={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar preferencias' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});