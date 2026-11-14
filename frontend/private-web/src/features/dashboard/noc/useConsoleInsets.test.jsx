import { cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSOLE_INSET_GAP_PX } from './consoleInsets';
import { useConsoleInsets } from './useConsoleInsets';

// The console's insets and its last measurement (useConsoleInsets.js). jsdom lays nothing out: the map's box and the
// board are given their rects, in window pixels, through getBoundingClientRect.

const RECTS = Object.freeze({
  box: { left: 0, top: 0, right: 1400, bottom: 800 },
  board: { left: 12, top: 12, right: 460, bottom: 572 },
});
const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** The hook on a box with the board in it; `onCommit` hears, after every commit, what it rendered and measured. */
function Harness({ enabled = true, onCommit }) {
  const { insets, rootRef, measure, measured } = useConsoleInsets({ enabled, ResizeObserverImpl: null });
  useEffect(() => { onCommit({ rendered: insets, measured: measured() }); });
  return (
    <div ref={rootRef} data-rect="box">
      <section ref={measure('board')} data-rect="board" data-folded="false" />
    </div>
  );
}

let laidOut = null;

function layOut() {
  const original = Element.prototype.getBoundingClientRect;
  laidOut = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function boundingClientRect() {
    const rect = RECTS[this.getAttribute('data-rect')];
    return rect ? { ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }
      : original.call(this);
  });
}

afterEach(() => {
  cleanup();
  laidOut?.mockRestore();
  laidOut = null;
});

describe('useConsoleInsets', () => {
  it('answers its last measurement, with the size of the box, ahead of the render that has it', () => {
    layOut();
    const commits = [];
    render(<Harness onCommit={commit => commits.push(commit)} />);
    const insets = { ...ZERO, left: RECTS.board.right + CONSOLE_INSET_GAP_PX };
    // The first commit measured the board while it still rendered no insets; the next one renders them.
    expect(commits[0]).toEqual({ rendered: ZERO, measured: { insets, width: 1400, height: 800 } });
    expect(commits.at(-1)).toEqual({ rendered: insets, measured: { insets, width: 1400, height: 800 } });
  });

  it('measures nothing while it is off', () => {
    layOut();
    const commits = [];
    const view = render(<Harness onCommit={commit => commits.push(commit)} />);
    view.rerender(<Harness enabled={false} onCommit={commit => commits.push(commit)} />);
    expect(commits.at(-1)).toEqual({ rendered: ZERO, measured: { insets: ZERO, width: 0, height: 0 } });
  });
});
