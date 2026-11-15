import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { buildMilestonePhases } from './milestonePhases';
import OccMilestoneStrip, { OCC_MILESTONE_STATUSES, OCC_MILESTONE_VARIANTS } from './OccMilestoneStrip';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

// Punta Cana is UTC−4: 18:41 UTC is 14:41 at the station.
const ZONE = 'America/Santo_Domingo';
const RECORDED = Object.freeze([
  { code: 'BLOCK_ON', actualAt: '2026-11-14T18:41:00Z' },
  { code: 'WALKAROUND_START', actualAt: '2026-11-14T18:43:00Z' },
  { code: 'WALKAROUND_END', actualAt: '2026-11-14T18:49:00Z' },
  { code: 'FIRST_CUSTOMS', actualAt: '2026-11-14T18:52:00Z' },
]);
const PHASES = buildMilestonePhases(RECORDED);

const classesOf = element => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const phaseOf = id => document.querySelector(`li[data-phase="${id}"]`);

describe('OccMilestoneStrip', () => {
  it('shows «3 de 6» per phase with filled and hollow ticks and no lateness colour', () => {
    expect(OCC_MILESTONE_VARIANTS).toEqual(['compact', 'full']);
    expect(OCC_MILESTONE_STATUSES).toEqual(['ready', 'empty']);
    render(<OccMilestoneStrip phases={PHASES} timeZone={ZONE} className="mt-2" />);
    const strip = screen.getByRole('list', { name: 'Hitos de la escala' });
    expect(strip.tagName).toBe('OL');
    expect(classesOf(strip).at(-1)).toBe('mt-2');
    const segments = within(strip).getAllByRole('listitem');
    expect(segments.map(segment => segment.dataset.phase)).toEqual(['arrival', 'on_stand', 'departure', 'pushback']);
    expect(segments.map(segment => segment.textContent)).toEqual([
      'Llegada 3 de 6', 'En posición 1 de 13', 'Salida 0 de 4', 'Retroempuje 0 de 2',
    ]);
    // Four phases on one line: each label sits over its count, so the counts line up.
    for (const segment of segments) expect(segment.querySelector('p')).toHaveClass('flex-col');
    // One tick per milestone, hidden from assistive technology: filled when recorded, hollow while pending.
    const ticks = phaseOf('arrival').querySelectorAll('[data-tick]');
    expect(ticks).toHaveLength(6);
    expect(ticks[0].closest('[aria-hidden="true"]')).not.toBeNull();
    expect([...ticks].map(tick => tick.dataset.tick)).toEqual(['done', 'done', 'done', 'pending', 'pending', 'pending']);
    expect(classesOf(ticks[0])).toEqual(expect.arrayContaining(['bg-occ-text', 'border-occ-text']));
    expect(classesOf(ticks[3])).toEqual(expect.arrayContaining(['border', 'border-occ-line-strong']));
    expect(classesOf(ticks[3])).not.toContain('bg-occ-text');
    // Filled or hollow, every tick has the same border, so they share the width of the phase evenly.
    for (const tick of ticks) expect(classesOf(tick)).toContain('border');
    expect(phaseOf('on_stand').querySelectorAll('[data-tick]')).toHaveLength(13);
    // No colour says «late»: no milestone has a target time. Nothing amber, red or cyan.
    for (const element of [strip, ...strip.querySelectorAll('*')]) {
      expect(classesOf(element).filter(name => /occ-(?:warn|danger|accent)/.test(name))).toEqual([]);
    }
    // The compact strip lists no milestone by name.
    expect(screen.queryByText('Bloqueo')).not.toBeInTheDocument();
  });

  it('lists the 25 milestones with their times or «Pendiente» in the full variant', () => {
    render(<OccMilestoneStrip phases={PHASES} variant="full" timeZone={ZONE} />);
    const milestones = document.querySelectorAll('li[data-milestone]');
    expect(milestones).toHaveLength(25);
    const blockOn = document.querySelector('li[data-milestone="BLOCK_ON"]');
    expect(blockOn).toHaveTextContent('Bloqueo');
    expect(within(blockOn).getByText('14:41').tagName).toBe('TIME');
    expect(within(blockOn).getByText('14:41')).toHaveAttribute('dateTime', '2026-11-14T18:41:00Z');
    expect(within(blockOn).getByText('14:41')).toHaveClass('font-mono');
    expect(document.querySelector('li[data-milestone="FIRST_CUSTOMS"]')).toHaveTextContent('Primeras aduanas 14:52');
    const pushback = document.querySelector('li[data-milestone="PUSHBACK"]');
    expect(pushback).toHaveTextContent('Push-back');
    expect(within(pushback).getByText('Pendiente')).toHaveClass('text-occ-muted');
    expect([...milestones].filter(item => item.textContent.endsWith('Pendiente'))).toHaveLength(21);
    // Each phase keeps its own ordered list, inside its segment, with its count at the end of the label's line.
    expect(within(phaseOf('departure')).getAllByRole('listitem')).toHaveLength(4);
    expect(phaseOf('departure').querySelector('ol')).not.toBeNull();
    expect(phaseOf('departure').querySelector('p')).toHaveClass('justify-between');
  });

  it('says when the turnaround has no operation yet, and speaks English inside the scope', () => {
    const { rerender } = render(<OccMilestoneStrip phases={PHASES} status="empty" />);
    expect(screen.getByText('Los hitos aparecen cuando la escala tiene una operación.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    act(() => resetLanguageForTests('en'));
    rerender(
      <LanguageScope>
        <OccMilestoneStrip phases={buildMilestonePhases(RECORDED, 'en')} variant="full" timeZone={ZONE} />
      </LanguageScope>,
    );
    const strip = screen.getByRole('list', { name: 'Turnaround milestones' });
    expect(within(strip).getAllByRole('listitem').find(item => item.dataset.phase === 'arrival'))
      .toHaveTextContent(/^Arrival 3 of 6/);
    expect(document.querySelector('li[data-milestone="BLOCK_ON"]')).toHaveTextContent('Block on 14:41');
    expect(document.querySelector('li[data-milestone="PUSHBACK"]')).toHaveTextContent('Pushback');
    expect(within(document.querySelector('li[data-milestone="PUSHBACK"]')).getByText('Pending')).toBeInTheDocument();
    rerender(<LanguageScope><OccMilestoneStrip phases={[]} status="empty" /></LanguageScope>);
    expect(screen.getByText('Milestones appear when the turnaround has an operation.')).toBeInTheDocument();

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccMilestoneStrip phases={PHASES} variant="wide" />)).toThrow(RangeError);
      expect(() => render(<OccMilestoneStrip phases={PHASES} status="unavailable" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
