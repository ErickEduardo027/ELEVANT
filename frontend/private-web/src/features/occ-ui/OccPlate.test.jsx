import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OccPlate, { PLATE_KINDS } from './OccPlate';

afterEach(cleanup);

describe('OccPlate', () => {
  it('draws each kind of identifier as a mono plate around its text', () => {
    expect(PLATE_KINDS).toEqual(['stand', 'flight', 'registration', 'code', 'station']);
    render(<p>{PLATE_KINDS.map(kind => <OccPlate key={kind} kind={kind}>{`Placa ${kind}`}</OccPlate>)}</p>);
    for (const kind of PLATE_KINDS) {
      const plate = screen.getByText(`Placa ${kind}`);
      expect(plate).toHaveAttribute('data-occ-plate', kind);
      // IBM Plex Mono on a 2 px slab with the strong joint (contratos 2.4).
      expect(plate.className).toMatch(/(?:^|\s)font-mono(?:\s|$)/);
      expect(plate.className).toMatch(/(?:^|\s)rounded-sm(?:\s|$)/);
      expect(plate.className).toMatch(/(?:^|\s)border-occ-line-strong(?:\s|$)/);
    }
    // Without a kind it is a code plate.
    const { container } = render(<OccPlate>MDPC</OccPlate>);
    expect(container.firstChild).toHaveAttribute('data-occ-plate', 'code');
  });

  it('is text and not a control: its text is what assistive technology reads, and the keyboard passes it by', async () => {
    render(<><OccPlate kind="station">PUJ</OccPlate><button type="button">Después</button></>);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByText('PUJ')).not.toHaveAttribute('tabindex');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Después' })).toHaveFocus();
  });

  it('rejects a kind it does not know', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<OccPlate kind="gate">B21</OccPlate>)).toThrow(RangeError);
    } finally {
      consoleError.mockRestore();
    }
  });
});
