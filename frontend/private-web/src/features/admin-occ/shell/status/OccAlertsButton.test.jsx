import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../../i18n/languageStore';
import OccAlertsButton from './OccAlertsButton';

const NONE = { unreceivedCount: 0, highest: null };
// The instant of the last good read before a failed refresh: 18:02 UTC is 14:02 in Punta Cana.
const STALE_SINCE = '2026-11-12T18:02:00.000Z';

function alerts(props) {
  return <LanguageScope><OccAlertsButton status="success" summary={NONE} onOpen={vi.fn()} {...props} /></LanguageScope>;
}

const tintsOf = element => element.className.split(/\s+/).filter(name => /^bg-occ-(?:warn|danger)-soft$/.test(name));
const glyphOf = element => element.querySelector('[data-occ-glyph]');
// Whether the count and the words sit in the dimmed run of a count that is no longer current.
const isDimmed = node => node.closest('.text-occ-muted') !== null;

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

  it('shows a neutral Alertas while the notices load or the account may not read them', () => {
    const summary = { unreceivedCount: 2, highest: 'urgent' };
    const view = render(alerts({ status: 'loading', summary }));
    // Nothing was read, so there is no count to mark as not updated either.
    for (const status of ['loading', 'idle', 'forbidden', 'unauthorized']) {
      view.rerender(alerts({ status, summary, staleSince: STALE_SINCE }));
      const button = screen.getByRole('button', { name: 'Alertas' });
      expect(glyphOf(button), status).toBeNull();
      expect(button.querySelector('svg'), status).not.toBeNull();
      expect(button, status).not.toHaveAttribute('aria-describedby');
      expect(tintsOf(button), status).toEqual([]);
      expect(within(button).queryByTestId('notifications-badge'), status).not.toBeInTheDocument();
    }
  });

  it('says Alertas: sin datos with the attention triangle when the notices could not be read', () => {
    const summary = { unreceivedCount: 2, highest: 'urgent' };
    const view = render(alerts({ status: 'error', summary }));
    for (const status of ['error', 'timeout']) {
      view.rerender(alerts({ status, summary, staleSince: STALE_SINCE }));
      // Not the neutral «Alertas» of a read under way: words, shape and tint of its own.
      const button = screen.getByRole('button', { name: 'Alertas: sin datos' });
      expect(glyphOf(button), status).toHaveAttribute('data-shape', 'triangle');
      expect(tintsOf(button), status).toEqual(['bg-occ-warn-soft']);
      // Nothing was read: no count, no priority and no time to tell.
      expect(within(button).queryByTestId('notifications-badge'), status).not.toBeInTheDocument();
      expect(button, status).toHaveAttribute('data-alert-priority', 'none');
      expect(button, status).not.toHaveAttribute('aria-describedby');
    }
    view.unmount();

    resetLanguageForTests('en');
    render(alerts({ status: 'timeout' }));
    expect(glyphOf(screen.getByRole('button', { name: 'Alerts: no data' }))).toHaveAttribute('data-shape', 'triangle');
  });

  it('keeps the last count, dimmed, after a failed refresh and says since when', () => {
    const view = render(alerts({ summary: { unreceivedCount: 3, highest: 'urgent' }, staleSince: STALE_SINCE }));
    const urgent = screen.getByRole('button', {
      name: '3 alertas, sin actualizar', description: 'Urgente. Sin actualizar desde las 14:02',
    });
    // A known urgent alert keeps its octagon and its tint; the count stays in the badge, dimmed.
    expect(glyphOf(urgent)).toHaveAttribute('data-shape', 'octagon');
    expect(tintsOf(urgent)).toEqual(['bg-occ-danger-soft']);
    const badge = within(urgent).getByTestId('notifications-badge');
    expect(badge).toHaveTextContent(/^3$/);
    expect(isDimmed(badge)).toBe(true);

    view.rerender(alerts({ summary: { unreceivedCount: 1, highest: 'attention' }, staleSince: STALE_SINCE }));
    const attention = screen.getByRole('button', {
      name: '1 alerta, sin actualizar', description: 'Atención. Sin actualizar desde las 14:02',
    });
    expect(glyphOf(attention)).toHaveAttribute('data-shape', 'triangle');
    expect(tintsOf(attention)).toEqual(['bg-occ-warn-soft']);

    // A calm that is no longer current cannot be vouched for: it asks for attention.
    for (const status of ['success', 'empty']) {
      view.rerender(alerts({ status, summary: NONE, staleSince: STALE_SINCE }));
      const calm = screen.getByRole('button', {
        name: 'Sin alertas, sin actualizar', description: 'Sin actualizar desde las 14:02',
      });
      expect(glyphOf(calm), status).toHaveAttribute('data-shape', 'triangle');
      expect(tintsOf(calm), status).toEqual(['bg-occ-warn-soft']);
      expect(calm, status).toHaveAttribute('data-alert-priority', 'none');
      expect(isDimmed(within(calm).getByText('Sin alertas')), status).toBe(true);
    }

    // The next good read takes the mark away.
    view.rerender(alerts({ summary: { unreceivedCount: 3, highest: 'urgent' }, staleSince: null }));
    const current = screen.getByRole('button', { name: '3 alertas', description: 'Urgente' });
    expect(isDimmed(within(current).getByTestId('notifications-badge'))).toBe(false);
    view.unmount();

    resetLanguageForTests('en');
    render(alerts({ summary: { unreceivedCount: 2, highest: 'urgent' }, staleSince: STALE_SINCE }));
    expect(screen.getByRole('button', {
      name: '2 alerts, not updated', description: 'Urgent. Not updated since 14:02',
    })).toBeInTheDocument();
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

    // Why a count cannot be trusted takes its own class, so the bar shows those words only where it has room; the
    // triangle and the count stay on screen.
    const detail = 'sr-only 2xl:not-sr-only';
    view.rerender(alerts({ status: 'error', summary: NONE, labelClassName: label, detailClassName: detail }));
    const failed = screen.getByRole('button', { name: 'Alertas: sin datos' });
    expect(within(failed).getByText('Alertas').className).toBe(label);
    expect(within(failed).getByText(': sin datos').className).toBe(detail);
    expect(glyphOf(failed)).toHaveAttribute('data-shape', 'triangle');
    view.rerender(alerts({
      summary: { unreceivedCount: 3, highest: 'urgent' }, staleSince: STALE_SINCE, labelClassName: label,
      detailClassName: detail,
    }));
    const stale = screen.getByRole('button', { name: '3 alertas, sin actualizar' });
    expect(within(stale).getByTestId('notifications-badge').className.split(/\s+/)).not.toContain('sr-only');
    expect(within(stale).getByText('alertas', { exact: false }).className).toBe(label);
    expect(within(stale).getByText(', sin actualizar').className).toBe(detail);
  });

  it('opens the alerts and tells whether its panel is open', async () => {
    const onOpen = vi.fn();
    const view = render(alerts({ onOpen }));
    const button = screen.getByRole('button', { name: 'Sin alertas' });
    // Without a panel to control it states none.
    expect(button).not.toHaveAttribute('aria-expanded');
    expect(button).not.toHaveAttribute('aria-haspopup');
    await userEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);

    // The drawer it opens: the dialog it pops up, whether it is open and, while it is, its id.
    view.rerender(alerts({ onOpen, expanded: false }));
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    view.rerender(alerts({ onOpen, expanded: true, controls: 'occ-alerts-drawer' }));
    expect(screen.getByRole('button', { name: 'Sin alertas' })).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'occ-alerts-drawer');
  });

  it('hands its button to a ref, so the drawer can give focus back to it', () => {
    const ref = { current: null };
    render(alerts({ ref, summary: { unreceivedCount: 2, highest: 'urgent' } }));
    expect(ref.current).toBe(screen.getByRole('button', { name: '2 alertas' }));
  });
});
