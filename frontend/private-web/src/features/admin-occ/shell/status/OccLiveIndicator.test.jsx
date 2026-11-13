import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../../i18n/languageStore';
import OccLiveIndicator from './OccLiveIndicator';

// 18:02 UTC is 14:02 in Punta Cana.
const LAST_OK = Date.parse('2026-11-12T18:02:00Z');
const SINCE = Date.parse('2026-11-12T18:03:00Z');
const live = state => ({ state, since: SINCE, lastOkAt: LAST_OK });

function indicator(value) {
  return <LanguageScope><OccLiveIndicator live={value} /></LanguageScope>;
}

const classesOf = element => element.className.split(/\s+/);

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

describe('OccLiveIndicator', () => {
  it('shows each of the four live words with a shape', () => {
    const cases = [
      ['live', 'En vivo', 'dot', null],
      ['reconnecting', 'Reconectando', 'half-dot', null],
      ['polling', 'Sin tiempo real', 'triangle', 'bg-occ-warn-soft'],
      ['offline', 'Sin conexión', 'octagon', 'bg-occ-danger-soft'],
    ];
    for (const [state, word, shape, tint] of cases) {
      const view = render(indicator(live(state)));
      const button = screen.getByRole('button', { name: word });
      expect(button.querySelector('[data-shape]'), state).toHaveAttribute('data-shape', shape);
      // Normal states carry no hue; the two signals get their container.
      const tints = classesOf(button).filter(name => name === 'bg-occ-warn-soft' || name === 'bg-occ-danger-soft');
      expect(tints, state).toEqual(tint ? [tint] : []);
      view.unmount();
    }
    // Four states, four shapes: none of them is told by colour alone.
    expect(new Set(cases.map(([, , shape]) => shape)).size).toBe(4);
    // A state it does not know reads as offline rather than live.
    render(indicator({ state: 'connected', since: SINCE, lastOkAt: LAST_OK }));
    expect(screen.getByRole('button', { name: 'Sin conexión' })).toBeInTheDocument();
  });

  it('opens its one-sentence explanation on click and on Enter', async () => {
    const view = render(indicator(live('live')));
    await userEvent.click(screen.getByRole('button', { name: 'En vivo' }));
    expect(screen.getByRole('dialog', { name: 'Enlace en vivo' })).toHaveTextContent(/^Los cambios llegan al momento\.$/);
    await userEvent.click(screen.getByRole('button', { name: 'En vivo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const sentences = {
      reconnecting: ['Reconectando', 'Reintentando la conexión en vivo.'],
      polling: ['Sin tiempo real', 'La pantalla se actualiza cada 25 segundos.'],
      offline: ['Sin conexión', 'Sin respuesta de ELEVANT desde las 14:02.'],
    };
    for (const [state, [word, sentence]] of Object.entries(sentences)) {
      view.rerender(indicator(live(state)));
      act(() => screen.getByRole('button', { name: word }).focus());
      await userEvent.keyboard('{Enter}');
      const dialog = screen.getByRole('dialog', { name: 'Enlace en vivo' });
      expect(dialog.textContent, state).toBe(sentence);
      await userEvent.keyboard('{Escape}');
    }

    // Without any answer yet, «desde» is when the link went down.
    view.rerender(indicator({ state: 'offline', since: SINCE, lastOkAt: null }));
    await userEvent.click(screen.getByRole('button', { name: 'Sin conexión' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Sin respuesta de ELEVANT desde las 14:03.');
    await userEvent.keyboard('{Escape}');

    // In English.
    act(() => resetLanguageForTests('en'));
    view.rerender(indicator(live('polling')));
    await userEvent.click(screen.getByRole('button', { name: 'No real time' }));
    expect(screen.getByRole('dialog', { name: 'Live link' })).toHaveTextContent('The screen refreshes every 25 seconds.');
  });

  it('Esc closes the popover, prevents default and returns focus', async () => {
    render(indicator(live('reconnecting')));
    const button = screen.getByRole('button', { name: 'Reconectando' });
    await userEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Enlace en vivo' });
    expect(dialog).toHaveFocus();
    expect(fireEvent.keyDown(dialog, { key: 'Escape' })).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('keeps its word for screen readers where only the glyph shows', () => {
    render(<LanguageScope><OccLiveIndicator live={live('live')} labelClassName="sr-only sm:not-sr-only" /></LanguageScope>);
    const word = screen.getByText('En vivo');
    expect(classesOf(word)).toEqual(['sr-only', 'sm:not-sr-only']);
    expect(screen.getByRole('button', { name: 'En vivo' })).toBeInTheDocument();
  });
});
