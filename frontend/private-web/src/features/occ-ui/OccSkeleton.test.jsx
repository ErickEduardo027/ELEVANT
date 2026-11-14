import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import OccSkeleton, { OCC_SKELETON_VARIANTS } from './OccSkeleton';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

const blocksOf = element => element.querySelectorAll('[data-occ-skeleton-block]');
const classesOf = element => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('OccSkeleton', () => {
  it('is a status with a hidden label and static blocks, never an animation', () => {
    const { rerender } = render(<OccSkeleton />);
    const status = screen.getByRole('status');
    // Its only words are the hidden label.
    expect(status.textContent).toBe('Cargando…');
    expect(within(status).getByText('Cargando…')).toHaveClass('sr-only');
    // The slabs are hidden from assistive technology and drawn with the raised slab on the plate radius.
    const blocks = blocksOf(status);
    expect(blocks).toHaveLength(3);
    for (const block of blocks) expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(status.querySelectorAll('.bg-occ-panel-raised.rounded-sm').length).toBeGreaterThanOrEqual(3);
    // Nothing shimmers, pulses or moves.
    for (const element of [status, ...status.querySelectorAll('*')]) {
      expect(classesOf(element).filter(name => /animate-|transition|motion-/.test(name))).toEqual([]);
    }

    // A panel names what loads; English inside the language scope.
    rerender(<OccSkeleton label="Cargando avisos…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando avisos…');
    resetLanguageForTests('en');
    rerender(<LanguageScope><OccSkeleton /></LanguageScope>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
  });

  it('draws rows, tiles, text and map, and rejects an unknown variant', () => {
    expect(OCC_SKELETON_VARIANTS).toEqual(['rows', 'tiles', 'text', 'map']);
    for (const variant of OCC_SKELETON_VARIANTS) {
      const { unmount } = render(<OccSkeleton variant={variant} rows={4} className="mt-2" />);
      const status = screen.getByRole('status');
      expect(status).toHaveAttribute('data-occ-skeleton', variant);
      // A map is one slab; the others draw as many rows, tiles or lines as asked.
      expect(blocksOf(status), variant).toHaveLength(variant === 'map' ? 1 : 4);
      expect(classesOf(status).at(-1)).toBe('mt-2');
      unmount();
    }
    // Lines of text end at different lengths.
    render(<OccSkeleton variant="text" rows={3} />);
    expect(new Set([...blocksOf(screen.getByRole('status'))].map(line => classesOf(line).find(name => name.startsWith('w-'))))
      .size).toBe(3);
    cleanup();
    // A count that makes no sense draws the default three.
    for (const rows of [0, -2, 'muchas', Number.NaN]) {
      const { unmount } = render(<OccSkeleton rows={rows} />);
      expect(blocksOf(screen.getByRole('status')), String(rows)).toHaveLength(3);
      unmount();
    }

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccSkeleton variant="shimmer" />)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
