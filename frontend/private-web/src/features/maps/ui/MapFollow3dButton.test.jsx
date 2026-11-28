import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../../i18n/languageStore';
import { OCC_MAP_IDLE, OccMapContext } from '../core/OccMapContext';
import MapFollow3dButton from './MapFollow3dButton';

// «Seguir en 3D» in the rail (M4) over a map context of its own: the same `follow.three` as the data block's button.
function renderButton({ follow = {}, three = {}, engineStatus = 'ready' } = {}) {
  const value = { ...OCC_MAP_IDLE, engineStatus,
    follow: { available: true, following: false, canFollow: true, toggle: vi.fn(),
      three: { on: false, start: vi.fn(), stop: vi.fn(), ...three }, ...follow } };
  const view = render(
    <LanguageScope>
      <OccMapContext.Provider value={value}><MapFollow3dButton /></OccMapContext.Provider>
    </LanguageScope>,
  );
  return { ...view, three: value.follow.three };
}

afterEach(() => {
  cleanup();
  act(() => resetLanguageForTests('es'));
});

describe('MapFollow3dButton (M4)', () => {
  it('starts «Seguir en 3D» on the chosen aircraft and says the double click does the same; no key of its own', () => {
    const { three } = renderButton();
    const button = screen.getByRole('button', { name: 'Seguir en 3D' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).not.toHaveAttribute('aria-keyshortcuts');
    expect(button).toHaveAttribute('title', 'Seguir en 3D el avión elegido. También con doble clic sobre un avión.');
    fireEvent.click(button);
    expect(three.start).toHaveBeenCalledTimes(1);
    expect(three.stop).not.toHaveBeenCalled();
  });

  it('is pressed while the camera orbits the aircraft, and pressed again stops and flies back', () => {
    const { three } = renderButton({ follow: { following: true, canFollow: false }, three: { on: true } });
    const button = screen.getByRole('button', { name: 'Seguir en 3D' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('border-occ-accent', 'bg-occ-accent-soft');
    expect(button).toHaveAttribute('title', 'Dejar de seguir en 3D y volver a la vista anterior.');
    fireEvent.click(button);
    expect(three.stop).toHaveBeenCalledTimes(1);
    expect(three.start).not.toHaveBeenCalled();
  });

  it('waits, disabled, until the selection names an aircraft the map draws', () => {
    renderButton({ follow: { canFollow: false } });
    const button = screen.getByRole('button', { name: 'Seguir en 3D' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Elige un avión del mapa para seguirlo en 3D, o haz doble clic sobre él.');
  });

  it('speaks English on an English screen', () => {
    act(() => resetLanguageForTests('en'));
    renderButton();
    expect(screen.getByRole('button', { name: 'Follow in 3D' }))
      .toHaveAttribute('title', 'Follow the chosen aircraft in 3D. A double click on an aircraft does the same.');
  });

  it('is not there on a map that cannot follow, cannot draw or has no 3D follow', () => {
    const { container } = renderButton({ follow: { available: false } });
    expect(container).toBeEmptyDOMElement();
    cleanup();
    const { container: unavailable } = renderButton({ engineStatus: 'unavailable' });
    expect(unavailable).toBeEmptyDOMElement();
    cleanup();
    const { container: noThree } = renderButton({ follow: { three: null } });
    expect(noThree).toBeEmptyDOMElement();
    cleanup();
    const { container: outside } = render(<LanguageScope><MapFollow3dButton /></LanguageScope>);
    expect(outside).toBeEmptyDOMElement();
  });
});
