import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../../i18n/languageStore';
import OccAlertsButton from './OccAlertsButton';

const NONE = { unreceivedCount: 0, highest: null };

function alerts(props) {
  return <LanguageScope><OccAlertsButton status="success" summary={NONE} onOpen={vi.fn()} {...props} /></LanguageScope>;
}

const tintsOf = element => element.className.split(/\s+/).filter(name => /^bg-occ-(?:warn|danger)-soft$/.test(name));

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

describe('OccAlertsButton', () => {
  it('says Sin alertas, 1 alerta and {count} alertas', () => {
    const view = render(alerts({ status: 'empty' }));
    expect(screen.getByRole('button', { name: 'Sin alertas' })).toBeInTheDocument();
    view.rerender(alerts({ summary: NONE }));
    expect(screen.getByRole('button', { name: 'Sin alertas' })).toBeInTheDocument();
    view.rerender(alerts({ summary: { unreceivedCount: 1, highest: 'attention' } }));
    expect(screen.getByRole('button', { name: '1 alerta' })).toBeInTheDocument();
    view.rerender(alerts({ summary: { unreceivedCount: 4, highest: 'urgent' } }));
    expect(screen.getByRole('button', { name: '4 alertas' })).toBeInTheDocument();
    view.unmount();

    resetLanguageForTests('en');
    const english = render(alerts({ summary: NONE }));
    expect(screen.getByRole('button', { name: 'No alerts' })).toBeInTheDocument();
    english.rerender(alerts({ summary: { unreceivedCount: 1, highest: 'urgent' } }));
    expect(screen.getByRole('button', { name: '1 alert' })).toBeInTheDocument();
    english.rerender(alerts({ summary: { unreceivedCount: 12, highest: 'attention' } }));
    expect(screen.getByRole('button', { name: '12 alerts' })).toBeInTheDocument();
  });

  it('keeps notifications-badge on the count only when there are unreceived alerts', () => {
    const view = render(alerts({ summary: { unreceivedCount: 3, highest: 'attention' } }));
    const button = screen.getByRole('button', { name: '3 alertas' });
    expect(within(button).getByTestId('notifications-badge')).toHaveTextContent(/^3$/);
    view.rerender(alerts({ summary: { unreceivedCount: 1, highest: 'urgent' } }));
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent(/^1$/);
    view.rerender(alerts({ summary: NONE }));
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
    view.rerender(alerts({ status: 'loading', summary: { unreceivedCount: 3, highest: 'urgent' } }));
    expect(screen.queryByTestId('notifications-badge')).not.toBeInTheDocument();
  });

  it('shows the glyph of the highest unreceived priority with its word, never colour alone', () => {
    const view = render(alerts({ summary: { unreceivedCount: 2, highest: 'urgent' } }));
    const urgent = screen.getByRole('button', { name: '2 alertas', description: 'Urgente' });
    expect(urgent.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'octagon');
    expect(urgent.querySelector('[data-occ-glyph]')).toHaveAttribute('aria-hidden', 'true');
    expect(tintsOf(urgent)).toEqual(['bg-occ-danger-soft']);

    view.rerender(alerts({ summary: { unreceivedCount: 2, highest: 'attention' } }));
    const attention = screen.getByRole('button', { name: '2 alertas', description: 'Atención' });
    expect(attention.querySelector('[data-occ-glyph]')).toHaveAttribute('data-shape', 'triangle');
    expect(tintsOf(attention)).toEqual(['bg-occ-warn-soft']);

    // Nothing to receive: no glyph, no word, no hue.
    view.rerender(alerts({ summary: NONE }));
    const calm = screen.getByRole('button', { name: 'Sin alertas' });
    expect(calm.querySelector('[data-occ-glyph]')).toBeNull();
    expect(calm).not.toHaveAttribute('aria-describedby');
    expect(tintsOf(calm)).toEqual([]);
    view.unmount();

    resetLanguageForTests('en');
    render(alerts({ summary: { unreceivedCount: 2, highest: 'urgent' } }));
    expect(screen.getByRole('button', { name: '2 alerts', description: 'Urgent' })).toBeInTheDocument();
  });

  it('shows a neutral Alertas while notices load, fail or are forbidden', () => {
    const summary = { unreceivedCount: 2, highest: 'urgent' };
    const view = render(alerts({ status: 'loading', summary }));
    for (const status of ['loading', 'idle', 'error', 'timeout', 'forbidden', 'unauthorized']) {
      view.rerender(alerts({ status, summary }));
      const button = screen.getByRole('button', { name: 'Alertas' });
      expect(button.querySelector('[data-occ-glyph]'), status).toBeNull();
      expect(button, status).not.toHaveAttribute('aria-describedby');
      expect(tintsOf(button), status).toEqual([]);
    }
  });

  it('can show the glyph and the count alone, keeping the whole phrase for screen readers', () => {
    const label = 'sr-only sm:not-sr-only';
    const view = render(alerts({ summary: { unreceivedCount: 3, highest: 'urgent' }, labelClassName: label }));
    const button = screen.getByRole('button', { name: '3 alertas', description: 'Urgente' });
    // The number stays on screen; only the words around it take the class.
    const badge = within(button).getByTestId('notifications-badge');
    expect(badge.className.split(/\s+/)).not.toContain('sr-only');
    expect(within(button).getByText('alertas', { exact: false }).className).toBe(label);

    // With nothing to count, the word goes and the bell stays.
    view.rerender(alerts({ summary: NONE, labelClassName: label }));
    expect(screen.getByText('Sin alertas').className).toBe(label);
    view.rerender(alerts({ status: 'loading', summary: NONE, labelClassName: label }));
    expect(screen.getByText('Alertas').className).toBe(label);
    expect(screen.getByRole('button', { name: 'Alertas' }).querySelector('svg')).not.toBeNull();
  });

  it('opens the alerts and tells whether its panel is open', async () => {
    const onOpen = vi.fn();
    const view = render(alerts({ onOpen }));
    const button = screen.getByRole('button', { name: 'Sin alertas' });
    // In this step it opens a page, so it states no expanded panel.
    expect(button).not.toHaveAttribute('aria-expanded');
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    view.rerender(alerts({ onOpen, expanded: true }));
    expect(screen.getByRole('button', { name: 'Sin alertas' })).toHaveAttribute('aria-expanded', 'true');
  });
});
