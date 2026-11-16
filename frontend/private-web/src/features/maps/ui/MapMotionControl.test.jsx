import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { OCC_MAP_IDLE, OccMapContext } from '../core/OccMapContext';
import MapMotionControl from './MapMotionControl';

// The control over a map context of its own: what OccMap shares of its motion (core/OccMapContext.js).
const NOON = Date.parse('2026-11-13T15:00:00.000Z');

function renderControl(motion = {}, { engineStatus = 'ready' } = {}) {
  const value = {
    ...OCC_MAP_IDLE,
    engineStatus,
    motion: { available: true, paused: false, pausedAt: null, dataAt: NOON, pause: vi.fn(), resume: vi.fn(), ...motion },
  };
  const view = render(
    <LanguageScope>
      <OccMapContext.Provider value={value}><MapMotionControl /></OccMapContext.Provider>
    </LanguageScope>,
  );
  return { ...view, motion: value.motion };
}

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

describe('MapMotionControl', () => {
  it('pauses the movement with a button and says so while it is paused', () => {
    const { motion, rerender } = renderControl();
    const button = screen.getByRole('button', { name: 'Pausar movimiento' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    // A tool of the dock's size: its name is its label and its title, its glyph the two bars of a pause.
    expect(button).toHaveAttribute('title', 'Pausar movimiento');
    expect(button).toHaveTextContent('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(motion.pause).toHaveBeenCalledTimes(1);
    expect(motion.resume).not.toHaveBeenCalled();

    // Paused: the button says it resumes, and the chip says the data keeps coming, with the station's time of the
    // newest (11:00 in Punta Cana at the lab's noon).
    const paused = { ...motion, paused: true, pausedAt: NOON - 5_000 };
    rerender(
      <LanguageScope>
        <OccMapContext.Provider value={{ ...OCC_MAP_IDLE, engineStatus: 'ready', motion: paused }}>
          <MapMotionControl />
        </OccMapContext.Provider>
      </LanguageScope>,
    );
    const resume = screen.getByRole('button', { name: 'Reanudar movimiento' });
    expect(resume).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Movimiento en pausa · datos de las 11:00');
    fireEvent.click(resume);
    expect(motion.resume).toHaveBeenCalledTimes(1);
    // No key of its own: a button (contracts 2.2).
    expect(resume).not.toHaveAttribute('aria-keyshortcuts');
  });

  it('says the time it holds when no data time is known, and nothing of a time with neither', () => {
    renderControl({ paused: true, pausedAt: NOON + 65_000, dataAt: null });
    expect(screen.getByRole('status')).toHaveTextContent('Movimiento en pausa · datos de las 11:01');
    cleanup();
    renderControl({ paused: true, pausedAt: null, dataAt: null });
    expect(screen.getByRole('status')).toHaveTextContent(/^Movimiento en pausa$/);
  });

  it('speaks English on an English screen', () => {
    act(() => resetLanguageForTests('en'));
    renderControl({ paused: true, pausedAt: NOON });
    expect(screen.getByRole('button', { name: 'Resume movement' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Movement paused · data from 11:00');
  });

  it('is not there on a map that does not move its traffic, or that cannot draw', () => {
    const { container } = renderControl({ available: false });
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const { container: unavailable } = renderControl({}, { engineStatus: 'unavailable' });
    expect(unavailable).toBeEmptyDOMElement();
    cleanup();
    // Outside a map there is nothing to pause.
    const { container: outside } = render(<LanguageScope><MapMotionControl /></LanguageScope>);
    expect(outside).toBeEmptyDOMElement();
  });
});
