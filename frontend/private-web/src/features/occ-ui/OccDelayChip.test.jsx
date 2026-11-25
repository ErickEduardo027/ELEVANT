import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import { DELAY_ATTENTION_MIN, DELAY_SHOWN_MIN, delayChipOf, delayMinutesOf } from './occDelay';
import OccDelayChip from './OccDelayChip';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

const NOW = Date.parse('2026-11-14T18:00:00Z');
const at = minutes => new Date(NOW + minutes * 60_000).toISOString();

describe('occDelay', () => {
  it('counts the minutes the actual time, else the estimate, runs past the scheduled one', () => {
    expect(delayMinutesOf({ scheduledAt: at(0), estimatedAt: at(12), actualAt: null })).toBe(12);
    // The actual time wins over the estimate.
    expect(delayMinutesOf({ scheduledAt: at(0), estimatedAt: at(12), actualAt: at(20) })).toBe(20);
    expect(delayMinutesOf({ scheduledAt: NOW, estimatedAt: NOW + 90_000 })).toBe(2);
    // On time, early, or without the times to tell: no delay.
    expect(delayMinutesOf({ scheduledAt: at(0), estimatedAt: at(0) })).toBeNull();
    expect(delayMinutesOf({ scheduledAt: at(0), actualAt: at(-6) })).toBeNull();
    expect(delayMinutesOf({ scheduledAt: null, estimatedAt: at(10) })).toBeNull();
    expect(delayMinutesOf({ scheduledAt: at(0) })).toBeNull();
    expect(delayMinutesOf(null)).toBeNull();
  });

  it('shows a chip from 5 minutes, and asks for attention from 15, the on-time limit', () => {
    expect([DELAY_SHOWN_MIN, DELAY_ATTENTION_MIN]).toEqual([5, 15]);
    expect(delayChipOf(4)).toBeNull();
    expect(delayChipOf(null)).toBeNull();
    expect(delayChipOf(5)).toEqual({ minutes: 5, signal: null });
    expect(delayChipOf(14)).toEqual({ minutes: 14, signal: null });
    expect(delayChipOf(15)).toEqual({ minutes: 15, signal: 'attention' });
  });
});

describe('OccDelayChip', () => {
  it('draws «+N» on a plate with no hue, and the amber triangle from 15 minutes, never colour alone', () => {
    const { rerender, container } = render(<OccDelayChip minutes={3} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<OccDelayChip minutes={8} />);
    const chip = container.querySelector('[data-occ-delay]');
    expect(chip).toHaveAttribute('data-occ-delay', '8');
    expect(chip).toHaveAttribute('data-signal', 'none');
    expect(chip).toHaveTextContent('+88 min de demora');
    expect(chip.querySelector('[data-occ-glyph]')).toBeNull();
    const classes = chip.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['font-mono', 'tabular-nums', 'border-occ-line-strong', 'text-xs']));
    expect(classes.filter(name => /occ-(?:accent|warn|danger)/.test(name))).toEqual([]);

    rerender(<OccDelayChip minutes={18} />);
    expect(chip).toHaveAttribute('data-signal', 'attention');
    expect(chip.querySelector('[data-occ-glyph="attention"]')).not.toBeNull();
    expect(chip).toHaveTextContent('Atención: 18 min de demora');
  });

  it('says it in English', () => {
    resetLanguageForTests('en');
    render(<LanguageScope><OccDelayChip minutes={20} /></LanguageScope>);
    expect(screen.getByText('Attention: 20 min late')).toBeInTheDocument();
  });
});
