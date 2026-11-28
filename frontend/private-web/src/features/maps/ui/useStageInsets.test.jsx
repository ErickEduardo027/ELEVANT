import { cleanup, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAGE_INSET_GAP_PX } from './stageInsets';
import { useStageInsets } from './useStageInsets';

// A map screen's insets and its last measurement (useStageInsets.js). jsdom lays nothing out: the map's box and the
// panels are given their rects, in window pixels, through getBoundingClientRect.

// The control column's reserve at the right edge of the map (occ-map.css, --occ-map-rail-reserve: stageInsets.test.js).
const RAIL_RESERVE_PX = 112;
const RECTS = Object.freeze({
  box: { left: 0, top: 0, right: 1400, bottom: 800 },
  board: { left: 12, top: 12, right: 460, bottom: 572 },
  // An inspector 352 px wide floating left of the control column.
  inspector: { left: 1400 - RAIL_RESERVE_PX - 352, top: 12, right: 1400 - RAIL_RESERVE_PX, bottom: 788 },
  // A note the screen names no edge for.
  note: { left: 600, top: 300, right: 800, bottom: 400 },
});
const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const BOARD_ONLY = Object.freeze({ board: 'side' });

/** The hook on a box with the screen's panels in it; `onCommit` hears, after every commit, what it rendered and measured. */
function Harness({ enabled = true, edges, panels = ['board'], onCommit }) {
  const { insets, rootRef, measure, measured } = useStageInsets({ edges, enabled, ResizeObserverImpl: null });
  useEffect(() => { onCommit({ rendered: insets, measured: measured() }); });
  return (
    <div ref={rootRef} data-rect="box">
      {panels.map(panelId => <section key={panelId} ref={measure(panelId)} data-rect={panelId} data-folded="false" />)}
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

describe('useStageInsets', () => {
  it('answers its last measurement, with the size of the box, ahead of the render that has it', () => {
    layOut();
    const commits = [];
    render(<Harness edges={BOARD_ONLY} onCommit={commit => commits.push(commit)} />);
    const insets = { ...ZERO, left: RECTS.board.right + STAGE_INSET_GAP_PX };
    // The first commit measured the board while it still rendered no insets; the next one renders them.
    expect(commits[0]).toEqual({ rendered: ZERO, measured: { insets, width: 1400, height: 800 } });
    expect(commits.at(-1)).toEqual({ rendered: insets, measured: { insets, width: 1400, height: 800 } });
  });

  it('takes each panel\'s edge from the screen\'s edges map, and nothing from a panel it names no edge for (M1)', () => {
    layOut();
    const commits = [];
    render(<Harness edges={{ board: 'left', inspector: 'right' }} panels={['board', 'inspector', 'note']}
      onCommit={commit => commits.push(commit)} />);
    // The inspector left of the control column: its width, the column's reserve and the gap.
    expect(commits.at(-1).rendered).toEqual({
      ...ZERO, left: RECTS.board.right + STAGE_INSET_GAP_PX, right: 352 + RAIL_RESERVE_PX + STAGE_INSET_GAP_PX,
    });
    // Without an edges map no panel takes room.
    cleanup();
    const bare = [];
    render(<Harness panels={['board', 'inspector']} onCommit={commit => bare.push(commit)} />);
    expect(bare.at(-1)).toEqual({ rendered: ZERO, measured: { insets: ZERO, width: 1400, height: 800 } });
  });

  it('measures nothing while it is off', () => {
    layOut();
    const commits = [];
    const view = render(<Harness edges={BOARD_ONLY} onCommit={commit => commits.push(commit)} />);
    view.rerender(<Harness edges={BOARD_ONLY} enabled={false} onCommit={commit => commits.push(commit)} />);
    expect(commits.at(-1)).toEqual({ rendered: ZERO, measured: { insets: ZERO, width: 0, height: 0 } });
  });
});
