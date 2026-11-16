import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import OccEmptyState from './OccEmptyState';

afterEach(cleanup);

const EMPTY_DAY = 'No hay escalas registradas para esta estación y fecha local.';

describe('OccEmptyState', () => {
  it('says what is absent in one sentence with one action and no illustration', () => {
    const { container, rerender } = render(
      <OccEmptyState title={EMPTY_DAY} action={<button type="button">Importar vuelos</button>} className="mt-1" />,
    );
    const empty = container.querySelector('[data-occ-empty]');
    // One sentence, in primary text.
    expect(empty.querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByText(EMPTY_DAY)).toHaveClass('text-occ-text', 'text-sm');
    // One action, and no picture of any kind.
    expect(within(empty).getAllByRole('button')).toHaveLength(1);
    expect(within(empty).getByRole('button', { name: 'Importar vuelos' })).toBeInTheDocument();
    expect(empty.querySelector('svg, img, picture, canvas')).toBeNull();
    expect(empty.className.split(/\s+/).at(-1)).toBe('mt-1');

    // A second line in secondary text, and no action when there is nothing to do.
    rerender(<OccEmptyState title="No hay alertas sin atender." description="Las alertas nuevas aparecen aquí." />);
    const paragraphs = container.querySelectorAll('[data-occ-empty] p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]).toHaveTextContent('Las alertas nuevas aparecen aquí.');
    expect(paragraphs[1]).toHaveClass('text-occ-muted');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
